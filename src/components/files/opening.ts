import type { SetStateAction } from "react";
import { type Card, createEmptyCard, fsrs, type Grade, generatorParameters } from "ts-fsrs";
import { z } from "zod";
import type { PracticeData } from "@/state/atoms";
import { isPrefix } from "@/utils/misc";
import { type TreeNode, treeIterator, getNodeAtPath } from "@/utils/treeReducer";

const params = generatorParameters({ enable_fuzz: true });

const f = fsrs(params);

export const positionSchema = z.object({
    fen: z.string(),
    answer: z.string(),
    card: z.object({}).passthrough(),
});

export type Position = {
    fen: string;
    answer: string;
    card: Card;
};

export function buildFromTree(tree: TreeNode, color: "white" | "black", start: number[]) {
    const cards: Position[] = [];
    const iterator = treeIterator(tree);
    for (const item of iterator) {
        if (
            item.node.children.length === 0 ||
            isPrefix(item.position, start) ||
            !item.node.children[0].san ||
            cards.find((c) => c.fen === item.node.fen)
        ) {
            continue;
        }
        if (
            (color === "white" && item.node.halfMoves % 2 === 0) ||
            (color === "black" && item.node.halfMoves % 2 === 1)
        ) {
            cards.push({
                fen: item.node.fen,
                answer: item.node.children[0].san,
                card: createEmptyCard(),
            });
        }
    }
    return cards;
}

type Stats = {
    unseen: number;
    due: number;
    practiced: number;
    nextDue: Date | null;
    total: number;
};

export function getStats(positions: Position[]) {
    const stats: Stats = {
        unseen: 0,
        due: 0,
        practiced: 0,
        nextDue: null,
        total: positions.length,
    };
    const now = new Date();
    for (const card of positions) {
        const dueDate = new Date(card.card.due);
        if (card.card.reps === 0) {
            stats.unseen++;
        } else if (dueDate <= now) {
            stats.due++;
        } else {
            stats.practiced++;
            if (!stats.nextDue || dueDate < stats.nextDue) {
                stats.nextDue = dueDate;
            }
        }
    }
    return stats;
}

export function getCardForReview(
    positions: Position[],
    options: { random: boolean } = { random: false },
): Position | null {
    if (options.random) {
        return positions[Math.floor(Math.random() * positions.length)];
    }
    const now = new Date();

    const filtered = positions.filter((position) => new Date(position.card.due) <= now);

    return filtered.length > 0 ? filtered[0] : null;
}

export function updateCardPerformance(
    setPositions: React.Dispatch<SetStateAction<PracticeData>>,
    i: number,
    card: Card,
    grade: 1 | 2 | 3 | 4,
) {
    const schedulingCards = f.repeat(card, new Date());

    const { card: newCard, log } = schedulingCards[grade];

    setPositions((data) => {
        data.positions[i].card = newCard;
        data.logs.push({ ...log, fen: data.positions[i].fen });
        return {
            positions: data.positions,
            logs: data.logs,
        };
    });
}

export function syncDeck(
    existing: Position[],
    tree: TreeNode,
    color: "white" | "black",
    start: number[],
): { positions: Position[]; added: number; removed: number } {
    const freshPositions = buildFromTree(tree, color, start);

    const existingByFen = new Map<string, Position>();
    for (const pos of existing) {
        existingByFen.set(pos.fen, pos);
    }

    let added = 0;
    const merged: Position[] = [];
    for (const pos of freshPositions) {
        const prev = existingByFen.get(pos.fen);
        if (prev) {
            merged.push({ ...prev, answer: pos.answer });
        } else {
            merged.push(pos);
            added++;
        }
    }

    const freshFens = new Set(freshPositions.map((p) => p.fen));
    const removed = existing.filter((p) => !freshFens.has(p.fen)).length;

    return { positions: merged, added, removed };
}

export function getNextReviewTimes(card: Card): Record<Grade, Date> {
    const schedulingCards = f.repeat(card, new Date());
    return {
        1: schedulingCards[1].card.due,
        2: schedulingCards[2].card.due,
        3: schedulingCards[3].card.due,
        4: schedulingCards[4].card.due,
    };
}

export function formatReviewInterval(dueDate: Date): string {
    const now = new Date();
    const diffMs = dueDate.getTime() - now.getTime();
    const diffMin = Math.round(diffMs / 60000);
    const diffHrs = Math.round(diffMs / 3600000);
    const diffDays = Math.round(diffMs / 86400000);

    if (diffMin < 1) return "< 1m";
    if (diffMin < 60) return `${diffMin}m`;
    if (diffHrs < 24) return `${diffHrs}h`;
    if (diffDays < 30) return `${diffDays}d`;
    return `${Math.round(diffDays / 30)}mo`;
}

// Line-based practice types
export type Line = {
    id: string;
    name: string;
    startFen: string;
    endFen: string;
    path: number[];
    startPath: number[];
    moves: string[];
    fullMoves: string[];
    card: Card;
};

// Build lines from tree - each line is a complete path from start to a leaf for the player's color
export function buildLinesFromTree(tree: TreeNode, color: "white" | "black", start: number[]): Line[] {
    const lines: Line[] = [];
    const startNode = getNodeAtPath(tree, start);
    if (!startNode) return lines;
    
    // Find all leaf nodes
    const iterator = treeIterator(tree);
    
    for (const item of iterator) {
        if (item.node.children.length === 0 && !isPrefix(item.position, start)) {
            // This is a leaf node, build a line from start to this leaf
            const pathAfterStart = item.position.slice(start.length);
            
            // Build the line by walking from start through pathAfterStart
            let node: TreeNode = startNode;
            const movesForPlayer: string[] = [];
            const allMoves: string[] = [];
            let currentPath = [...start];
            
            for (const childIndex of pathAfterStart) {
                if (node.children[childIndex]) {
                    const child = node.children[childIndex];
                    if (child.san) {
                        allMoves.push(child.san);
                        // Check if this move is for the player's color
                        const isPlayerMove = (color === "white" && node.halfMoves % 2 === 0) || 
                                           (color === "black" && node.halfMoves % 2 === 1);
                        if (isPlayerMove) {
                            movesForPlayer.push(child.san);
                        }
                    }
                    node = child;
                    currentPath = [...currentPath, childIndex];
                }
            }
            
            // Only add this line if it has at least one move for the player
            if (movesForPlayer.length > 0) {
                const lineId = currentPath.join(",");
                const lineName = allMoves.join(" ");
                
                lines.push({
                    id: lineId,
                    name: lineName,
                    startFen: startNode.fen,
                    endFen: node.fen,
                    path: currentPath,
                    startPath: start,
                    moves: movesForPlayer,
                    fullMoves: allMoves,
                    card: createEmptyCard(),
                });
            }
        }
    }
    
    return lines;
}

// Stats for lines
export type LineStats = {
    unseen: number;
    due: number;
    practiced: number;
    nextDue: Date | null;
    total: number;
};

export function getLineStats(lines: Line[]): LineStats {
    const stats: LineStats = {
        unseen: 0,
        due: 0,
        practiced: 0,
        nextDue: null,
        total: lines.length,
    };
    const now = new Date();
    for (const line of lines) {
        const dueDate = new Date(line.card.due);
        if (line.card.reps === 0) {
            stats.unseen++;
        } else if (dueDate <= now) {
            stats.due++;
        } else {
            stats.practiced++;
            if (!stats.nextDue || dueDate < stats.nextDue) {
                stats.nextDue = dueDate;
            }
        }
    }
    return stats;
}

// Get a line for review based on SRS
export function getLineForReview(lines: Line[]): Line | null {
    const now = new Date();
    const filtered = lines.filter((line) => new Date(line.card.due) <= now);
    return filtered.length > 0 ? filtered[0] : null;
}

// Update line performance in the deck
export function updateLinePerformance(
    setLines: React.Dispatch<SetStateAction<{ lines: Line[]; logs: any[] }>>,
    lineIndex: number,
    card: Card,
    grade: 1 | 2 | 3 | 4,
) {
    const schedulingCards = f.repeat(card, new Date());
    const { card: newCard, log } = schedulingCards[grade];

    setLines((data) => {
        data.lines[lineIndex].card = newCard;
        data.logs.push({ ...log, lineId: data.lines[lineIndex].id });
        return {
            lines: data.lines,
            logs: data.logs,
        };
    });
}

// Sync lines with tree changes
export function syncLinesDeck(
    existing: Line[],
    tree: TreeNode,
    color: "white" | "black",
    start: number[],
): { lines: Line[]; added: number; removed: number } {
    const freshLines = buildLinesFromTree(tree, color, start);

    const existingById = new Map<string, Line>();
    for (const line of existing) {
        existingById.set(line.id, line);
    }

    let added = 0;
    const merged: Line[] = [];
    for (const line of freshLines) {
        const prev = existingById.get(line.id);
        if (prev) {
            merged.push({ ...prev, moves: line.moves, fullMoves: line.fullMoves, endFen: line.endFen, path: line.path });
        } else {
            merged.push(line);
            added++;
        }
    }

    const freshIds = new Set(freshLines.map((l) => l.id));
    const removed = existing.filter((l) => !freshIds.has(l.id)).length;

    return { lines: merged, added, removed };
}
