import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useToggle } from "@mantine/hooks";
import {
  IconArrowBack,
  IconArrowRight,
  IconBook,
  IconBulb,
  IconCheck,
  IconFlame,
  IconInfoCircle,
  IconTarget,
  IconX,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import { formatDate } from "ts-fsrs";
import { formatNumber } from "@/utils/format";
import { useStore } from "zustand";
import ConfirmModal from "@/components/common/ConfirmModal";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  buildFromTree,
  buildLinesFromTree,
  formatReviewInterval,
  getCardForReview,
  getLineForReview,
  getLineStats,
  getNextReviewTimes,
  getStats,
  scheduleLineCard,
  syncDeck,
  syncLinesDeck,
  updateCardPerformance,
  updateLinePerformance,
} from "@/components/files/opening";
import {
  currentEvalOpenAtom,
  currentInvisibleAtom,
  currentPracticeTabAtom,
  currentShowCommentsAtom,
  currentTabAtom,
  deckAtomFamily,
  type PracticeData,
  type PracticeSessionStats,
  lineDeckAtomFamily,
  practiceCardStartTimeAtom,
  practiceSessionStatsAtom,
  practiceStateAtom,
  practiceAutoDifficultyAtom,
  practiceModesVisibleAtom,
} from "@/state/atoms";
import { getTabFile, getTabGameNumber } from "@/utils/tabs";
import { findFen, getNodeAtPath } from "@/utils/treeReducer";
import RepertoireInfo from "./RepertoireInfo";

function PracticePanel() {
  const { t } = useTranslation();

  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const headers = useStore(store, (s) => s.headers);
  const goToMove = useStore(store, (s) => s.goToMove);
  const setPracticePath = useStore(store, (s) => s.setPracticePath);
  const currentFen = useStore(store, (s) => s.currentNode().fen);
  const treePosition = useStore(store, (s) => s.position);

  const currentTab = useAtomValue(currentTabAtom);
  const tabFile = getTabFile(currentTab);
  const [resetModal, toggleResetModal] = useToggle();

  const [deck, setDeck] = useAtom(
    deckAtomFamily({
      file: tabFile?.path || "",
      game: getTabGameNumber(currentTab),
    }),
  );

  const [syncMessage, setSyncMessage] = useState<{
    added: number;
    removed: number;
  } | null>(null);
  const deckPositionsRef = useRef(deck.positions);
  deckPositionsRef.current = deck.positions;
  const lastSyncedTreeRef = useRef<string | null>(null);

  useEffect(() => {
    const treeFingerprint = JSON.stringify(root);
    if (lastSyncedTreeRef.current === treeFingerprint) return;

    const orientation = headers.orientation || "white";
    const start = headers.start || [];

    // Ensure start is an array
    if (!Array.isArray(start)) {
      return;
    }

    if (deckPositionsRef.current.length === 0) {
      const newDeck = buildFromTree(root, orientation, start);
      if (newDeck.length > 0) {
        setDeck({ positions: newDeck, logs: [] });
      }
    } else {
      // Sync existing deck with tree changes
      const { positions, added, removed } = syncDeck(
        deckPositionsRef.current,
        root,
        orientation,
        start,
      );
      if (added > 0 || removed > 0) {
        setDeck((prev) => ({ ...prev, positions }));
        setSyncMessage({ added, removed });
        setTimeout(() => setSyncMessage(null), 5000);
      }
    }
    lastSyncedTreeRef.current = treeFingerprint;
  }, [root, headers, setDeck]);

  // Line deck (FSRS cards keyed by variation) — synced with the tree the same
  // way the move deck is. Only built when the file is a repertoire.
  const [lineDeck, setLineDeck] = useAtom(
    lineDeckAtomFamily({
      file: tabFile?.path || "",
      game: getTabGameNumber(currentTab),
    }),
  );
  const lineDeckPositionsRef = useRef(lineDeck.lines);
  lineDeckPositionsRef.current = lineDeck.lines;
  const lastSyncedLinesRef = useRef<string | null>(null);

  useEffect(() => {
    const treeFingerprint = JSON.stringify(root);
    if (lastSyncedLinesRef.current === treeFingerprint) return;

    const start = headers.start || [];
    if (!Array.isArray(start)) return;

    if (lineDeckPositionsRef.current.length === 0) {
      const newLines = buildLinesFromTree(root, start);
      if (newLines.length > 0) {
        setLineDeck({ lines: newLines, logs: [] });
      }
    } else {
      const { lines, added, removed } = syncLinesDeck(lineDeckPositionsRef.current, root, start);
      if (added > 0 || removed > 0) {
        setLineDeck((prev) => ({ ...prev, lines }));
      }
    }
    lastSyncedLinesRef.current = treeFingerprint;
  }, [root, headers, setLineDeck]);

  const stats = getStats(deck.positions);
  const lineStats = getLineStats(lineDeck.lines);

  const setInvisible = useSetAtom(currentInvisibleAtom);
  const setShowComments = useSetAtom(currentShowCommentsAtom);
  const setEvalOpen = useSetAtom(currentEvalOpenAtom);
  const [practiceState, setPracticeState] = useAtom(practiceStateAtom);
  const [sessionStats, setSessionStats] = useAtom(practiceSessionStatsAtom);
  const setCardStartTime = useSetAtom(practiceCardStartTimeAtom);
  const practiceAutoDifficulty = useAtomValue(practiceAutoDifficultyAtom);
  const practiceModesVisible = useAtomValue(practiceModesVisibleAtom);

  // Current correct move for the line being drilled, used by "Show solution".
  const currentLineAnswer = useMemo(() => {
    const lineTarget = practiceState.lineTargetPath || [];
    if (treePosition.length >= lineTarget.length) return null;
    const childIndex = lineTarget[treePosition.length];
    const node = getNodeAtPath(root, treePosition);
    return node.children[childIndex]?.san ?? null;
  }, [practiceState.lineTargetPath, treePosition, root]);

  // Number of moves the user still has to play in the current line (only their
  // own color, not the opponent's auto-played moves).
  const userMovesLeft = useMemo(() => {
    const lineTarget = practiceState.lineTargetPath || [];
    const orientation = practiceState.lineOrientation || "white";
    const startLen = headers.start?.length ?? 0;
    let total = 0;
    let done = 0;
    for (let i = startLen; i < lineTarget.length; i++) {
      const node = getNodeAtPath(root, lineTarget.slice(0, i));
      const isUserTurn = node.halfMoves % 2 === (orientation === "white" ? 0 : 1);
      if (!isUserTurn) continue;
      total++;
      if (i < treePosition.length) done++;
    }
    return Math.max(0, total - done);
  }, [
    practiceState.lineTargetPath,
    practiceState.lineOrientation,
    root,
    headers.start,
    treePosition,
  ]);

  const newPractice = useCallback(
    (stats?: Partial<PracticeSessionStats>) => {
      if (deck.positions.length === 0) return;

      const currentMode = stats?.mode ?? sessionStats.mode;
      const remaining = stats?.remainingPositions ?? sessionStats.remainingPositions;

      let c: (typeof deck.positions)[0] | null | undefined;

      if (currentMode === "full") {
        if (remaining.length > 0) {
          c = deck.positions[remaining[0]];
        } else {
          c = null;
        }
      } else {
        c = getCardForReview(deck.positions);
      }

      if (!c) {
        setPracticeState({ phase: "idle" });
        setPracticePath(null);
        setInvisible(false);
        setShowComments(true);
        setEvalOpen(true);
        return;
      }
      const path = findFen(c.fen, root);
      goToMove(path);
      setPracticePath(path);
      setInvisible(true);
      setShowComments(false);
      setEvalOpen(false);
      setCardStartTime(Date.now());
      setPracticeState({ phase: "waiting", currentFen: c.fen });
    },
    [
      deck.positions,
      sessionStats.mode,
      sessionStats.remainingPositions,
      root,
      goToMove,
      setPracticePath,
      setInvisible,
      setShowComments,
      setEvalOpen,
      setCardStartTime,
      setPracticeState,
    ],
  );

  useEffect(() => {
    if (practiceState.phase === "correct") {
      if (sessionStats.mode === "full") {
        const timer = setTimeout(() => {
          const remainingPositions = sessionStats.remainingPositions.slice(1);
          setSessionStats((prev) => ({
            ...prev,
            remainingPositions,
            correct: prev.correct + 1,
            streak: prev.streak + 1,
            bestStreak: Math.max(prev.bestStreak, prev.streak + 1),
          }));
          newPractice({ remainingPositions, mode: "full" });
        }, 300);
        return () => clearTimeout(timer);
      } else if (practiceAutoDifficulty !== "none" && practiceState.positionIndex !== undefined) {
        const positionIndex = practiceState.positionIndex;
        const timer = setTimeout(() => {
          const card = deck.positions[positionIndex].card;
          const grade = Number(practiceAutoDifficulty) as 1 | 2 | 3 | 4;

          updateCardPerformance(setDeck, positionIndex, card, grade);
          setSessionStats((prev) => ({
            ...prev,
            correct: prev.correct + 1,
            streak: prev.streak + 1,
            bestStreak: Math.max(prev.bestStreak, prev.streak + 1),
          }));
          newPractice();
        }, 300);
        return () => clearTimeout(timer);
      }
    }
  }, [
    practiceState.phase,
    practiceState.positionIndex,
    sessionStats.mode,
    sessionStats.remainingPositions,
    newPractice,
    setSessionStats,
    practiceAutoDifficulty,
    deck.positions,
    setDeck,
  ]);

  function handleQualityRating(grade: 1 | 2 | 3 | 4) {
    if (practiceState.phase !== "correct" || practiceState.positionIndex === undefined) return;

    const { positionIndex } = practiceState;
    const card = deck.positions[positionIndex].card;

    updateCardPerformance(setDeck, positionIndex, card, grade);
    setSessionStats((prev) => ({
      ...prev,
      correct: prev.correct + 1,
      streak: prev.streak + 1,
      bestStreak: Math.max(prev.bestStreak, prev.streak + 1),
    }));
    newPractice();
  }

  function startPractice() {
    const stats: Partial<PracticeSessionStats> = {
      mode: "anki",
      remainingPositions: [],
      correct: 0,
      incorrect: 0,
      streak: 0,
      bestStreak: 0,
    };
    setSessionStats((prev) => ({ ...prev, ...stats }));
    newPractice(stats);
  }

  function startFullPractice() {
    const indices = deck.positions.map((_, i) => i);
    const stats: Partial<PracticeSessionStats> = {
      mode: "full",
      remainingPositions: indices,
      correct: 0,
      incorrect: 0,
      streak: 0,
      bestStreak: 0,
    };
    setSessionStats((prev) => ({ ...prev, ...stats }));
    newPractice(stats);
  }

  function startLinesPractice() {
    const orientation = headers.orientation || "white";
    const start = headers.start || [];

    if (!Array.isArray(start)) {
      return;
    }

    // Make sure the line deck exists (it is normally built/synced on tree change).
    let cards = lineDeck.lines;
    if (cards.length === 0) {
      const built = buildLinesFromTree(root, start);
      if (built.length === 0) {
        notifications.show({
          title: t("Board.Practice.NoMovesInLine"),
          message: t("Board.Practice.NoMovesInLine"),
          color: "yellow",
        });
        return;
      }
      setLineDeck({ lines: built, logs: [] });
      cards = built;
    }

    const review = getLineForReview(cards);
    if (!review) {
      notifications.show({
        title: t("Board.Practice.LinesAllPracticed"),
        message: t("Board.Practice.LinesAllPracticed"),
        color: "green",
      });
      return;
    }

    setSessionStats((prev) => ({
      ...prev,
      mode: "lines",
      remainingPositions: [],
      correct: 0,
      incorrect: 0,
      streak: 0,
      bestStreak: 0,
      linesCompleted: 0,
    }));

    beginLine(review.index, review.line.path, orientation, cards);
  }

  function stopLinesPractice() {
    setPracticeState({ phase: "idle" });
    setPracticePath(null);
    setInvisible(false);
    setShowComments(true);
    setEvalOpen(true);
    setSessionStats({
      mode: "anki",
      remainingPositions: [],
      correct: 0,
      incorrect: 0,
      streak: 0,
      bestStreak: 0,
      linesCompleted: 0,
    });
  }

  // Move the drill to the given deck line (index + path), starting from the
  // repository start position. The board effect auto-plays opponent moves.
  function beginLine(
    index: number,
    path: number[],
    lineOrientation: "white" | "black" = headers.orientation || "white",
    cards: typeof lineDeck.lines = lineDeck.lines,
    feedback?: "correct",
  ) {
    const start = headers.start || [];
    goToMove(start);
    setPracticePath(start);
    setPracticeState({
      phase: "lines_waiting",
      lineTargetPath: path,
      lineOrientation,
      lines: cards.map((c) => c.path),
      lineIndex: index,
      feedback,
    });
    setInvisible(true);
    setShowComments(false);
    setEvalOpen(false);
    setCardStartTime(Date.now());
  }

  function skipCard() {
    if (sessionStats.mode === "full" && sessionStats.remainingPositions.length > 0) {
      const remainingPositions = sessionStats.remainingPositions.slice(1);
      setSessionStats((prev) => ({ ...prev, remainingPositions }));
      newPractice({ remainingPositions });
    } else if (sessionStats.mode === "lines") {
      // After an error, continue by auto-playing the correct move so the flow
      // keeps going instead of stopping on the board.
      setPracticeState({
        phase: "lines_waiting",
        lineTargetPath: practiceState.lineTargetPath,
        lineOrientation: practiceState.lineOrientation,
        lines: practiceState.lines,
        lineIndex: practiceState.lineIndex,
        autoAdvance: true,
      });
      setInvisible(true);
    } else {
      newPractice();
    }
  }

  // Called when the user rates a finished line (Again/Hard/Good/Easy): schedules
  // the line card via FSRS (like the classic move practice) and moves on to the
  // next line due for review, or ends the session when nothing is left to do.
  function rateLine(grade: 1 | 2 | 3 | 4) {
    const deckIndex = practiceState.lineIndex;
    if (deckIndex == null || deckIndex < 0 || deckIndex >= lineDeck.lines.length) {
      stopLinesPractice();
      return;
    }

    const card = lineDeck.lines[deckIndex].card;
    if (!card) {
      stopLinesPractice();
      return;
    }

    const nextCard = scheduleLineCard(card, grade);
    updateLinePerformance(setLineDeck, deckIndex, card, grade);
    setSessionStats((prev) => ({ ...prev, linesCompleted: prev.linesCompleted + 1 }));

    // Determine the next line due considering the just-rated card.
    const updated = lineDeck.lines.map((l, i) => (i === deckIndex ? { ...l, card: nextCard } : l));
    const next = getLineForReview(updated);

    if (next) {
      beginLine(next.index, next.line.path);
    } else {
      stopLinesPractice();
    }
  }

  // Reveal the correct move so the user can study it. Works both after an
  // incorrect move and when the user is simply stuck on the current position.
  function revealSolution() {
    setPracticeState((p) => ({
      ...p,
      showSolution: true,
      answer: p.answer ?? currentLineAnswer ?? undefined,
    }));
  }

  // After an error (or having seen the solution), play the correct move and
  // continue with the line.
  function advanceLine() {
    setPracticeState((p) => ({
      ...p,
      autoAdvance: true,
      showSolution: false,
      feedback: undefined,
    }));
    setInvisible(true);
  }

  useHotkeys("1", () => handleQualityRating(1), {
    enabled: practiceState.phase === "correct",
  });
  useHotkeys("2", () => handleQualityRating(2), {
    enabled: practiceState.phase === "correct",
  });
  useHotkeys("3", () => handleQualityRating(3), {
    enabled: practiceState.phase === "correct",
  });
  useHotkeys("4", () => handleQualityRating(4), {
    enabled: practiceState.phase === "correct",
  });
  useHotkeys("1", () => rateLine(1), {
    enabled: practiceState.phase === "lines_rating",
  });
  useHotkeys("2", () => rateLine(2), {
    enabled: practiceState.phase === "lines_rating",
  });
  useHotkeys("3", () => rateLine(3), {
    enabled: practiceState.phase === "lines_rating",
  });
  useHotkeys("4", () => rateLine(4), {
    enabled: practiceState.phase === "lines_rating",
  });
  useHotkeys("space", () => skipCard(), {
    enabled: practiceState.phase === "incorrect",
  });

  const [positionsOpen, setPositionsOpen] = useToggle();
  const [logsOpen, setLogsOpen] = useToggle();
  const [tab, setTab] = useAtom(currentPracticeTabAtom);

  return (
    <>
      <Tabs
        h="100%"
        orientation="vertical"
        placement="right"
        value={tab}
        onChange={(v) => setTab(v!)}
        style={{
          display: "flex",
        }}
      >
        <Tabs.List>
          <Tabs.Tab value="train">{t("Board.Practice.Train")}</Tabs.Tab>
          <Tabs.Tab value="build">{t("Board.Practice.Build")}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="train" style={{ overflow: "hidden" }}>
          <Stack p="sm" gap="md">
            {stats.total === 0 && (
              <Alert icon={<IconInfoCircle />}>
                <Stack gap="xs">
                  <Text fz="sm">{t("Board.Practice.NoPositionForTrain1")}</Text>
                  <Button variant="light" size="xs" onClick={() => setTab("build")}>
                    {t("Board.Practice.GoToBuild")}
                  </Button>
                </Stack>
              </Alert>
            )}
            {syncMessage && (
              <Alert
                title={t("Board.Practice.DeckSynced")}
                withCloseButton
                onClose={() => setSyncMessage(null)}
              >
                {syncMessage.added > 0 &&
                  t("Board.Practice.SyncAdded", {
                    count: syncMessage.added ?? 0,
                    number: formatNumber(syncMessage.added ?? 0),
                  })}
                {syncMessage.added > 0 && syncMessage.removed > 0 && " · "}
                {syncMessage.removed > 0 &&
                  t("Board.Practice.SyncRemoved", {
                    count: syncMessage.removed ?? 0,
                    number: formatNumber(syncMessage.removed ?? 0),
                  })}
              </Alert>
            )}
            {stats.total > 0 && (
              <>
                {(practiceModesVisible.anki || practiceModesVisible.full) && (
                  <>
                    <Stack gap={4}>
                      <Group justify="space-between">
                        <Text fz="xs" fw={500}>
                          {t("Board.Practice.Progress")}
                        </Text>
                        <Text fz="xs" c="dimmed">
                          {Math.round((stats.practiced / stats.total) * 100)}%
                        </Text>
                      </Group>
                      <Progress.Root size="sm">
                        <Tooltip label={`${t("Board.Practice.Practiced")}: ${stats.practiced}`}>
                          <Progress.Section
                            value={(stats.practiced / stats.total) * 100}
                            color="blue"
                          />
                        </Tooltip>
                        <Tooltip label={`${t("Board.Practice.Due")}: ${stats.due}`}>
                          <Progress.Section
                            value={(stats.due / stats.total) * 100}
                            color="yellow"
                          />
                        </Tooltip>
                        <Tooltip label={`${t("Board.Practice.Unseen")}: ${stats.unseen}`}>
                          <Progress.Section
                            value={(stats.unseen / stats.total) * 100}
                            color="gray"
                          />
                        </Tooltip>
                      </Progress.Root>
                    </Stack>

                    <SimpleGrid cols={3} spacing="xs">
                      <Paper p="xs" withBorder radius="sm">
                        <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                          {t("Board.Practice.Practiced")}
                        </Text>
                        <Text fz="lg" fw={700} c="blue">
                          {stats.practiced}
                        </Text>
                      </Paper>
                      <Paper p="xs" withBorder radius="sm">
                        <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                          {t("Board.Practice.Due")}
                        </Text>
                        <Text fz="lg" fw={700} c="yellow">
                          {stats.due}
                        </Text>
                      </Paper>
                      <Paper p="xs" withBorder radius="sm">
                        <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                          {t("Board.Practice.Unseen")}
                        </Text>
                        <Text fz="lg" fw={700} c="dimmed">
                          {stats.unseen}
                        </Text>
                      </Paper>
                    </SimpleGrid>
                  </>
                )}

                {(practiceState.phase !== "idle" ||
                  sessionStats.correct > 0 ||
                  sessionStats.incorrect > 0) && (
                  <SimpleGrid cols={3} spacing="xs">
                    <Paper p="xs" withBorder radius="sm">
                      <Group gap={4} wrap="nowrap">
                        <ThemeIcon size="xs" color="green" variant="transparent">
                          <IconCheck size={12} />
                        </ThemeIcon>
                        <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                          {t("Board.Practice.SessionCorrect")}
                        </Text>
                      </Group>
                      <Text fz="lg" fw={700} c="green">
                        {sessionStats.correct}
                      </Text>
                    </Paper>
                    <Paper p="xs" withBorder radius="sm">
                      <Group gap={4} wrap="nowrap">
                        <ThemeIcon size="xs" color="red" variant="transparent">
                          <IconX size={12} />
                        </ThemeIcon>
                        <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                          {t("Board.Practice.SessionIncorrect")}
                        </Text>
                      </Group>
                      <Text fz="lg" fw={700} c="red">
                        {sessionStats.incorrect}
                      </Text>
                    </Paper>
                    <Paper p="xs" withBorder radius="sm">
                      <Group gap={4} wrap="nowrap">
                        {sessionStats.correct + sessionStats.incorrect > 0 ? (
                          <ThemeIcon size="xs" color="teal" variant="transparent">
                            <IconTarget size={12} />
                          </ThemeIcon>
                        ) : (
                          <ThemeIcon size="xs" color="orange" variant="transparent">
                            <IconFlame size={12} />
                          </ThemeIcon>
                        )}
                        <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                          {sessionStats.correct + sessionStats.incorrect > 0
                            ? t("Board.Practice.Accuracy")
                            : t("Board.Practice.Streak")}
                        </Text>
                      </Group>
                      <Text
                        fz="lg"
                        fw={700}
                        c={sessionStats.correct + sessionStats.incorrect > 0 ? "teal" : "orange"}
                      >
                        {sessionStats.correct + sessionStats.incorrect > 0
                          ? `${Math.round(
                              (sessionStats.correct /
                                (sessionStats.correct + sessionStats.incorrect)) *
                                100,
                            )}%`
                          : sessionStats.streak}
                      </Text>
                    </Paper>
                  </SimpleGrid>
                )}

                {lineStats.total > 0 && practiceModesVisible.lines && (
                  <>
                    <Stack gap={4}>
                      <Group justify="space-between">
                        <Text fz="xs" fw={500}>
                          {t("Board.Practice.LinesProgress")}
                        </Text>
                        <Text fz="xs" c="dimmed">
                          {Math.round((lineStats.practiced / lineStats.total) * 100)}%
                        </Text>
                      </Group>
                      <Progress.Root size="sm">
                        <Tooltip label={`${t("Board.Practice.Practiced")}: ${lineStats.practiced}`}>
                          <Progress.Section
                            value={(lineStats.practiced / lineStats.total) * 100}
                            color="blue"
                          />
                        </Tooltip>
                        <Tooltip label={`${t("Board.Practice.Due")}: ${lineStats.due}`}>
                          <Progress.Section
                            value={(lineStats.due / lineStats.total) * 100}
                            color="yellow"
                          />
                        </Tooltip>
                        <Tooltip label={`${t("Board.Practice.Unseen")}: ${lineStats.unseen}`}>
                          <Progress.Section
                            value={(lineStats.unseen / lineStats.total) * 100}
                            color="gray"
                          />
                        </Tooltip>
                      </Progress.Root>
                    </Stack>
                    <SimpleGrid cols={3} spacing="xs">
                      <Paper p="xs" withBorder radius="sm">
                        <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                          {t("Board.Practice.Practiced")}
                        </Text>
                        <Text fz="lg" fw={700} c="blue">
                          {lineStats.practiced}
                        </Text>
                      </Paper>
                      <Paper p="xs" withBorder radius="sm">
                        <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                          {t("Board.Practice.Due")}
                        </Text>
                        <Text fz="lg" fw={700} c="yellow">
                          {lineStats.due}
                        </Text>
                      </Paper>
                      <Paper p="xs" withBorder radius="sm">
                        <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                          {t("Board.Practice.Unseen")}
                        </Text>
                        <Text fz="lg" fw={700} c="dimmed">
                          {lineStats.unseen}
                        </Text>
                      </Paper>
                    </SimpleGrid>
                  </>
                )}

                {practiceState.phase === "idle" && (
                  <Stack gap="sm">
                    {stats.due === 0 &&
                      stats.unseen === 0 &&
                      (practiceModesVisible.anki || practiceModesVisible.full) && (
                        <Paper p="sm" withBorder>
                          <Stack gap="xs" align="center">
                            <ThemeIcon size="xl" radius="xl" color="green" variant="light">
                              <IconCheck size={24} />
                            </ThemeIcon>
                            <Text ta="center" fw={500}>
                              {t("Board.Practice.PracticedAll1")}
                            </Text>
                            <Text ta="center" fz="sm" c="dimmed">
                              {t("Board.Practice.PracticedAll2")}{" "}
                              {dayjs(stats.nextDue).format("MMM D, HH:mm")}
                            </Text>
                          </Stack>
                        </Paper>
                      )}
                    {practiceModesVisible.anki && (stats.due > 0 || stats.unseen > 0) && (
                      <Button
                        size="md"
                        variant="light"
                        fullWidth
                        onClick={startPractice}
                        leftSection={<IconTarget size={20} />}
                        justify="space-between"
                        rightSection={
                          <Badge size="sm" variant="white" color="blue">
                            {stats.due + stats.unseen}
                          </Badge>
                        }
                      >
                        {t("Board.Practice.StartPractice")}
                      </Button>
                    )}
                    {practiceModesVisible.full && (
                      <Button
                        size="md"
                        variant="light"
                        color="gray"
                        fullWidth
                        onClick={startFullPractice}
                        leftSection={<IconBook size={20} />}
                        justify="space-between"
                        rightSection={
                          <Badge size="sm" variant="white" color="gray">
                            {deck.positions.length}
                          </Badge>
                        }
                      >
                        {t("Board.Practice.PracticeFullRepertoire")}
                      </Button>
                    )}
                    {practiceModesVisible.lines && (
                      <Button
                        size="md"
                        variant="light"
                        color="blue"
                        fullWidth
                        onClick={startLinesPractice}
                        leftSection={<IconArrowRight size={20} />}
                        justify="space-between"
                        rightSection={
                          <Badge size="sm" variant="white" color="blue">
                            {lineStats.due + lineStats.unseen}
                          </Badge>
                        }
                      >
                        {t("Board.Practice.PracticeLines")}
                      </Button>
                    )}
                  </Stack>
                )}

                {practiceState.phase === "waiting" && (
                  <Paper p="sm" withBorder>
                    {practiceState.currentFen && currentFen !== practiceState.currentFen ? (
                      <Stack gap="xs" align="center">
                        <Text ta="center" fz="sm" c="dimmed">
                          {t("Board.Practice.NotOnPosition")}
                        </Text>
                        <Button
                          variant="light"
                          size="xs"
                          leftSection={<IconArrowBack size={14} />}
                          onClick={() => {
                            goToMove(findFen(practiceState.currentFen!, root));
                            setInvisible(true);
                          }}
                        >
                          {t("Board.Practice.GoBackToPosition")}
                        </Button>
                      </Stack>
                    ) : (
                      <Group gap="xs" justify="center">
                        <Text ta="center" fz="sm" c="dimmed">
                          {t("Board.Practice.MakeYourMove")}
                        </Text>
                        <Button
                          variant="light"
                          size="compact-xs"
                          color="red"
                          onClick={() => {
                            setPracticeState({ phase: "idle" });
                            setPracticePath(null);
                            setInvisible(false);
                            setShowComments(true);
                            setEvalOpen(true);
                            setSessionStats({
                              mode: "anki",
                              remainingPositions: [],
                              correct: 0,
                              incorrect: 0,
                              streak: 0,
                              bestStreak: 0,
                              linesCompleted: 0,
                            });
                          }}
                        >
                          {t("Common.Stop")}
                        </Button>
                      </Group>
                    )}
                  </Paper>
                )}

                {practiceState.phase === "correct" && sessionStats.mode !== "full" && (
                  <QualityRatingPanel
                    onRate={handleQualityRating}
                    card={
                      practiceState.positionIndex !== undefined
                        ? deck.positions[practiceState.positionIndex].card
                        : undefined
                    }
                    timeTaken={practiceState.timeTaken}
                  />
                )}

                {practiceState.phase === "lines_waiting" && (
                  <Paper p="sm" withBorder>
                    <Stack gap="sm">
                      <Group justify="space-between" align="center" wrap="nowrap">
                        <Group gap="xs" wrap="nowrap">
                          <ThemeIcon
                            size="lg"
                            radius="md"
                            variant="light"
                            color={
                              practiceState.feedback === "incorrect"
                                ? "red"
                                : practiceState.feedback === "correct"
                                  ? "green"
                                  : "blue"
                            }
                          >
                            {practiceState.feedback === "incorrect" ? (
                              <IconX size={18} />
                            ) : practiceState.feedback === "correct" ? (
                              <IconCheck size={18} />
                            ) : (
                              <IconTarget size={18} />
                            )}
                          </ThemeIcon>
                          <Stack gap={0}>
                            <Text fz="xs" tt="uppercase" c="dimmed" fw={600}>
                              {t("Board.Practice.LinesMode")}
                            </Text>
                            <Text fw={700}>
                              {t("Board.Practice.LineCount", {
                                current: (practiceState.lineIndex ?? 0) + 1,
                                total: practiceState.lines?.length ?? 0,
                              })}
                            </Text>
                          </Stack>
                        </Group>
                        <Group gap={4} wrap="nowrap">
                          {!practiceState.showSolution && (
                            <Button
                              variant="subtle"
                              size="compact-xs"
                              onClick={revealSolution}
                              leftSection={<IconBulb size={14} />}
                            >
                              {t("Board.Practice.ShowSolution")}
                            </Button>
                          )}
                          <Button
                            variant="subtle"
                            size="compact-xs"
                            color="red"
                            onClick={stopLinesPractice}
                          >
                            {t("Common.Stop")}
                          </Button>
                        </Group>
                      </Group>

                      {(practiceState.feedback === "incorrect" || practiceState.showSolution) && (
                        <Paper p="sm" withBorder radius="sm">
                          <Group justify="space-between" align="center" wrap="nowrap">
                            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                              {practiceState.feedback === "incorrect" &&
                                !practiceState.showSolution && (
                                  <Badge
                                    color="red"
                                    size="sm"
                                    variant="light"
                                    leftSection={<IconX size={12} />}
                                  >
                                    {t("Common.Incorrect")}
                                  </Badge>
                                )}
                              {practiceState.showSolution ? (
                                <Text fz="sm" c="red" fw={600} truncate>
                                  {t("Board.Practice.CorrectMoveWas", {
                                    move: practiceState.answer,
                                  })}
                                </Text>
                              ) : (
                                <Text fz="xs" c="dimmed">
                                  {t("Board.Practice.TryAgain")}
                                </Text>
                              )}
                            </Group>
                            {!practiceState.showSolution ? (
                              <Button variant="light" size="compact-xs" onClick={revealSolution}>
                                {t("Board.Practice.ShowSolution")}
                              </Button>
                            ) : (
                              <Button
                                variant="light"
                                size="compact-xs"
                                color="green"
                                onClick={advanceLine}
                                leftSection={<IconArrowRight size={14} />}
                              >
                                {t("Board.Practice.Next")}
                              </Button>
                            )}
                          </Group>
                        </Paper>
                      )}

                      <Progress.Root size="sm">
                        <Tooltip label={`${t("Board.Practice.Practiced")}: ${lineStats.practiced}`}>
                          <Progress.Section
                            value={
                              lineStats.total ? (lineStats.practiced / lineStats.total) * 100 : 0
                            }
                            color="blue"
                          />
                        </Tooltip>
                        <Tooltip label={`${t("Board.Practice.Due")}: ${lineStats.due}`}>
                          <Progress.Section
                            value={lineStats.total ? (lineStats.due / lineStats.total) * 100 : 0}
                            color="yellow"
                          />
                        </Tooltip>
                        <Tooltip label={`${t("Board.Practice.Unseen")}: ${lineStats.unseen}`}>
                          <Progress.Section
                            value={lineStats.total ? (lineStats.unseen / lineStats.total) * 100 : 0}
                            color="gray"
                          />
                        </Tooltip>
                      </Progress.Root>

                      <SimpleGrid cols={3} spacing="xs">
                        <Paper p="xs" withBorder bg="var(--mantine-color-dark-6)">
                          <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                            {t("Board.Practice.Line")}
                          </Text>
                          <Text fw={700} c="blue">
                            {(practiceState.lineIndex ?? 0) + 1}/{practiceState.lines?.length ?? 0}
                          </Text>
                        </Paper>
                        <Paper p="xs" withBorder bg="var(--mantine-color-dark-6)">
                          <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                            {t("Board.Practice.MovesLeftShort")}
                          </Text>
                          <Text fw={700}>{userMovesLeft}</Text>
                        </Paper>
                        <Paper p="xs" withBorder bg="var(--mantine-color-dark-6)">
                          <Text fz={10} tt="uppercase" c="dimmed" fw={600}>
                            {t("Board.Practice.Turn")}
                          </Text>
                          <Text fw={700}>
                            {practiceState.lineOrientation === "white"
                              ? t("Common.White")
                              : t("Common.Black")}
                          </Text>
                        </Paper>
                      </SimpleGrid>

                      {practiceState.feedback === "correct" && (
                        <Badge
                          color="green"
                          size="sm"
                          variant="light"
                          leftSection={<IconCheck size={12} />}
                          style={{ alignSelf: "center" }}
                        >
                          {t("Common.Correct")}
                        </Badge>
                      )}
                    </Stack>
                  </Paper>
                )}
                {practiceState.phase === "lines_rating" && sessionStats.mode === "lines" && (
                  <QualityRatingPanel
                    onRate={rateLine}
                    card={
                      practiceState.lineIndex != null
                        ? lineDeck.lines[practiceState.lineIndex]?.card
                        : undefined
                    }
                    timeTaken={practiceState.timeTaken}
                  />
                )}
                {practiceState.phase === "incorrect" && (
                  <Paper p="sm" withBorder>
                    <Stack gap="xs" align="center">
                      <Group gap="xs">
                        <ThemeIcon size="md" color="red" variant="light" radius="xl">
                          <IconX size={16} />
                        </ThemeIcon>
                        <Text fw={500} c="red">
                          {t("Common.Incorrect")}
                        </Text>
                      </Group>
                      <Text fz="sm" c="dimmed">
                        {t("Board.Practice.CorrectMoveWas", {
                          move: practiceState.answer,
                        })}
                      </Text>
                      <Button variant="light" size="sm" onClick={skipCard}>
                        {t("Board.Practice.NextPosition")}
                      </Button>
                    </Stack>
                  </Paper>
                )}

                <Divider />

                <Group gap="xs">
                  <Button variant="subtle" size="xs" onClick={() => setPositionsOpen(true)}>
                    {t("Board.Practice.ShowAll")}
                  </Button>
                  <Button variant="subtle" size="xs" onClick={() => setLogsOpen(true)}>
                    {t("Board.Practice.ShowLogs")}
                  </Button>
                  <Button variant="subtle" size="xs" color="red" onClick={() => toggleResetModal()}>
                    {t("Common.Reset")}
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="build" style={{ overflow: "hidden" }}>
          <RepertoireInfo />
        </Tabs.Panel>
      </Tabs>

      <ConfirmModal
        title={t("Board.Practice.Reset.Title")}
        description={t("Board.Practice.Reset.Description", {
          name: tabFile?.name,
        })}
        opened={resetModal}
        onClose={toggleResetModal}
        onConfirm={() => {
          const cards = buildFromTree(root, headers.orientation || "white", headers.start || []);
          setDeck({ positions: cards, logs: [] });
          const lineCards = buildLinesFromTree(root, headers.start || []);
          setLineDeck({ lines: lineCards, logs: [] });
          setPracticeState({ phase: "idle" });
          setPracticePath(null);
          setInvisible(false);
          setShowComments(true);
          setEvalOpen(true);
          setSessionStats({
            mode: "anki",
            remainingPositions: [],
            correct: 0,
            incorrect: 0,
            streak: 0,
            bestStreak: 0,
            linesCompleted: 0,
          });
          toggleResetModal();
        }}
        confirmLabel={t("Common.Reset")}
      />
      {positionsOpen && (
        <PositionsModal open={positionsOpen} setOpen={setPositionsOpen} deck={deck} />
      )}
      <LogsModal open={logsOpen} setOpen={setLogsOpen} logs={deck.logs} />
    </>
  );
}

function QualityRatingPanel({
  onRate,
  card,
  timeTaken,
}: {
  onRate: (grade: 1 | 2 | 3 | 4) => void;
  card?: import("ts-fsrs").Card;
  timeTaken?: number;
}) {
  const { t } = useTranslation();
  const reviewTimes = card ? getNextReviewTimes(card) : null;

  return (
    <Paper p="sm" withBorder>
      <Stack gap="sm" align="center">
        <Group gap="xs">
          <ThemeIcon size="md" color="green" variant="light" radius="xl">
            <IconCheck size={16} />
          </ThemeIcon>
          <Text fw={500} c="green">
            {t("Board.Practice.Correct")}
          </Text>
          {timeTaken !== undefined && (
            <Text fz="xs" c="dimmed">
              ({(timeTaken / 1000).toFixed(1)}s)
            </Text>
          )}
        </Group>
        <Text fz="sm" c="dimmed">
          {t("Board.Practice.HowDifficult")}
        </Text>
        <SimpleGrid cols={4} spacing="xs" style={{ width: "100%" }}>
          <Tooltip label={t("Board.Practice.AgainHint")}>
            <Button
              color="red"
              variant="light"
              size="compact-md"
              onClick={() => onRate(1)}
              style={{ height: "auto", padding: "4px 0" }}
            >
              <Stack gap={0} align="center">
                <Text fz="xs" fw={600}>
                  {t("Board.Practice.Again")}
                </Text>
                <Text fz={10} c="dimmed">
                  {reviewTimes ? formatReviewInterval(reviewTimes[1]) : ""}
                </Text>
              </Stack>
            </Button>
          </Tooltip>
          <Tooltip label={t("Board.Practice.HardHint")}>
            <Button
              color="orange"
              variant="light"
              size="compact-md"
              onClick={() => onRate(2)}
              style={{ height: "auto", padding: "4px 0" }}
            >
              <Stack gap={0} align="center">
                <Text fz="xs" fw={600}>
                  {t("Board.Practice.Hard")}
                </Text>
                <Text fz={10} c="dimmed">
                  {reviewTimes ? formatReviewInterval(reviewTimes[2]) : ""}
                </Text>
              </Stack>
            </Button>
          </Tooltip>
          <Tooltip label={t("Board.Practice.GoodHint")}>
            <Button
              color="blue"
              variant="light"
              size="compact-md"
              onClick={() => onRate(3)}
              style={{ height: "auto", padding: "4px 0" }}
            >
              <Stack gap={0} align="center">
                <Text fz="xs" fw={600}>
                  {t("Board.Practice.Good")}
                </Text>
                <Text fz={10} c="dimmed">
                  {reviewTimes ? formatReviewInterval(reviewTimes[3]) : ""}
                </Text>
              </Stack>
            </Button>
          </Tooltip>
          <Tooltip label={t("Board.Practice.EasyHint")}>
            <Button
              color="green"
              variant="light"
              size="compact-md"
              onClick={() => onRate(4)}
              style={{ height: "auto", padding: "4px 0" }}
            >
              <Stack gap={0} align="center">
                <Text fz="xs" fw={600}>
                  {t("Board.Practice.Easy")}
                </Text>
                <Text fz={10} c="dimmed">
                  {reviewTimes ? formatReviewInterval(reviewTimes[4]) : ""}
                </Text>
              </Stack>
            </Button>
          </Tooltip>
        </SimpleGrid>
        <Text fz={10} c="dimmed">
          {t("Board.Practice.KeyboardHint")}
        </Text>
      </Stack>
    </Paper>
  );
}

function PositionsModal({
  open,
  setOpen,
  deck,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  deck: PracticeData;
}) {
  const { t } = useTranslation();

  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const goToMove = useStore(store, (s) => s.goToMove);
  return (
    <Modal
      opened={open}
      onClose={() => setOpen(false)}
      size="xl"
      title={<b>{t("Board.Practice.Positions")}</b>}
    >
      {deck.positions.length === 0 && <Text>{t("Board.Practice.NoPositionsYet")}</Text>}
      <SimpleGrid cols={2}>
        {deck.positions.map((c) => {
          const position = findFen(c.fen, root);
          const node = getNodeAtPath(root, position);
          return (
            <Card key={c.fen}>
              <Text>
                {Math.floor(node.halfMoves / 2) + 1}
                {node.halfMoves % 2 === 0 ? ". " : "... "}
                {c.answer}
              </Text>
              <Divider my="xs" />
              <Group justify="space-between">
                <Stack>
                  <Text tt="uppercase" fw="bold" fz="sm">
                    {t("Board.Practice.Status")}
                  </Text>
                  <Badge
                    color={c.card.reps === 0 ? "gray" : c.card.due < new Date() ? "yellow" : "blue"}
                  >
                    {c.card.reps === 0
                      ? t("Board.Practice.Unseen")
                      : c.card.due < new Date()
                        ? t("Board.Practice.Due")
                        : t("Board.Practice.Practiced")}
                  </Badge>
                </Stack>
                <Stack>
                  <Text tt="uppercase" fw="bold" fz="sm">
                    {t("Board.Practice.Due")}
                  </Text>
                  <Text>{formatDate(c.card.due)}</Text>
                </Stack>
                <ActionIcon
                  variant="subtle"
                  onClick={() => {
                    goToMove(position);
                    setOpen(false);
                  }}
                >
                  <IconArrowRight />
                </ActionIcon>
              </Group>
            </Card>
          );
        })}
      </SimpleGrid>
    </Modal>
  );
}

function LogsModal({
  open,
  setOpen,
  logs,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  logs: PracticeData["logs"];
}) {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const goToMove = useStore(store, (s) => s.goToMove);
  return (
    <Modal
      opened={open}
      onClose={() => setOpen(false)}
      size="xl"
      title={<b>{t("Board.Practice.Logs")}</b>}
    >
      <SimpleGrid cols={2}>
        {logs.length === 0 && <Text>{t("Board.Practice.NoLogsYet")}</Text>}
        {logs.map((log) => {
          const position = findFen(log.fen, root);
          const node = getNodeAtPath(root, position);

          return (
            <Card key={log.fen}>
              <Text>
                {Math.floor(node.halfMoves / 2) + 1}
                {node.halfMoves % 2 === 0 ? ". " : "... "}
                {node.san}
              </Text>

              <Divider my="xs" />
              <Group justify="space-between">
                <Stack>
                  <Text tt="uppercase" fw="bold" fz="sm">
                    {t("Board.Practice.Rating")}
                  </Text>
                  <Badge
                    color={
                      log.rating === 1
                        ? "red"
                        : log.rating === 2
                          ? "orange"
                          : log.rating === 3
                            ? "blue"
                            : "green"
                    }
                  >
                    {log.rating === 1
                      ? t("Board.Practice.Again")
                      : log.rating === 2
                        ? t("Board.Practice.Hard")
                        : log.rating === 3
                          ? t("Board.Practice.Good")
                          : t("Board.Practice.Easy")}
                  </Badge>
                </Stack>
                <Stack>
                  <Text tt="uppercase" fw="bold" fz="sm">
                    {t("Common.Date")}
                  </Text>
                  <Text>{formatDate(log.due)}</Text>
                </Stack>
                <ActionIcon
                  variant="subtle"
                  onClick={() => {
                    goToMove(position);
                    setOpen(false);
                  }}
                >
                  <IconArrowRight />
                </ActionIcon>
              </Group>
            </Card>
          );
        })}
      </SimpleGrid>
    </Modal>
  );
}

export default PracticePanel;
