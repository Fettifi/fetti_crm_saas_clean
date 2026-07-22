import AppLayout from "@/components/AppLayout";
import QuestBoard from "@/components/QuestBoard";

export default function TaskListPage() {
  return (
    <AppLayout
      title="✅ Tasks"
      description="Your to-do list — add a task, check it off."
    >
      <QuestBoard />
    </AppLayout>
  );
}
