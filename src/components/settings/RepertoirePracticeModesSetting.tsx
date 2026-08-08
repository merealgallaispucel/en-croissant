import { Checkbox, Stack } from "@mantine/core";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { practiceModesVisibleAtom } from "@/state/atoms";

export default function RepertoirePracticeModesSetting() {
  const { t } = useTranslation();
  const [modes, setModes] = useAtom(practiceModesVisibleAtom);

  const setMode = (key: "anki" | "full" | "lines") => (checked: boolean) =>
    setModes((prev) => ({ ...prev, [key]: checked }));

  return (
    <Stack gap="xs">
      <Checkbox
        label={t("Board.Practice.StartPractice")}
        checked={modes.anki}
        onChange={(e) => setMode("anki")(e.currentTarget.checked)}
      />
      <Checkbox
        label={t("Board.Practice.PracticeFullRepertoire")}
        checked={modes.full}
        onChange={(e) => setMode("full")(e.currentTarget.checked)}
      />
      <Checkbox
        label={t("Board.Practice.PracticeLines")}
        checked={modes.lines}
        onChange={(e) => setMode("lines")(e.currentTarget.checked)}
      />
    </Stack>
  );
}
