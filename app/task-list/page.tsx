import AppLayout from "@/components/AppLayout";
import QuestBoard from "@/components/QuestBoard";

export default function TaskListPage() {
  return (
    <AppLayout
      title="🎮 Quest Log"
      description="Clear quests, earn XP, level up, and keep your streak alive."
    >
      <QuestBoard />
    </AppLayout>
  );
}
