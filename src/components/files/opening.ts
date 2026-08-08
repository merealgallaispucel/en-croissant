import type { SetStateAction } from "react";
import { type Card, createEmptyCard, fsrs, type Grade, generatorParameters } from "ts-fsrs";
import { z } from "zod";
import type { LineDeckData, PracticeData } from "@/state/atoms";
import { isPrefix } from "@/utils/misc";
import { type TreeNode, treeIterator } from "@/utils/treeReducer";

const params = generatorParameters({ enable_fuzz: true });

const f = fsrs(params);
// Extract every complete line (root-to-leaf path) that starts at the given
// start path. Each multi-child node creates a new variation, so each distinct
// move choice yields its own line to practice.
export function getLinesFromTree(tree: TreeNode, start: number[] = []): number[][] {
    const lines: number[][] = [];

    const dfs = (node: TreeNode, path: number[]) => {
        if (node.children.length === 0) {
            if (path.length > start.length && isPrefix(start, path)) {
                lines.push(path);
            }
            return;
        }
        for (let i = 0; i < node.children.length; i++) {
            dfs(node.children[i], [...path, i]);
        }
    };

    dfs(tree, []);
    return lines;
}

export const lineSchema = z.object({
    key: z.string(),
    path: z.array(z.number()),
    card: z.object({}).passthrough(),
});

export type PracticeLine = {
    key: string;
    path: number[];
    card: Card;
};

// Stable identifier for a line: the SAN sequence of all its moves.
export function getLineKey(tree: TreeNode, path: number[]): string {
    const sans: string[] = [];
    let node = tree;
    for (const idx of path) {
        node = node.children[idx];
        if (!node) break;
        sans.push(node.san ?? "?");
    }
    return sans.join("|");
}

export function buildLinesFromTree(tree: TreeNode, start: number[] = []): PracticeLine[] {
    return getLinesFromTree(tree, start).map((path) => ({
        key: getLineKey(tree, path),
        path,
        card: createEmptyCard(),
    }));
}

export function getLineStats(lines: PracticeLine[]): Stats {
    const stats: Stats = {
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

export function getLineForReview(
    lines: PracticeLine[],
): { index: number; line: PracticeLine } | null {
    const now = new Date();
    for (let i = 0; i < lines.length; i++) {
        if (new Date(lines[i].card.due) <= now) {
            return { index: i, line: lines[i] };
        }
    }
    return null;
}

export function updateLinePerformance(
    setLines: React.Dispatch<SetStateAction<LineDeckData>>,
    i: number,
    card: Card,
    grade: 1 | 2 | 3 | 4,
) {
    const schedulingCards = f.repeat(card, new Date());

    const { card: newCard, log } = schedulingCards[grade];

    setLines((data) => {
        data.lines[i].card = newCard;
        data.logs.push({ ...log, line: data.lines[i].key });
        return data;
    });
}

export function scheduleLineCard(card: Card, grade: 1 | 2 | 3 | 4): Card {
    const { card: newCard } = f.repeat(card, new Date())[grade];
    return newCard;
}

export function syncLinesDeck(
    existing: PracticeLine[],
    tree: TreeNode,
    start: number[],
): { lines: PracticeLine[]; added: number; removed: number } {
    const freshLines = buildLinesFromTree(tree, start);

    const existingByKey = new Map<string, PracticeLine>();
    for (const line of existing) {
        existingByKey.set(line.key, line);
    }

    let added = 0;
    const merged: PracticeLine[] = [];
    for (const line of freshLines) {
        const prev = existingByKey.get(line.key);
        if (prev) {
            merged.push({ ...prev, path: line.path });
        } else {
            merged.push(line);
            added++;
        }
    }

    const freshKeys = new Set(freshLines.map((l) => l.key));
    const removed = existing.filter((l) => !freshKeys.has(l.key)).length;

    return { lines: merged, added, removed };
}

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
