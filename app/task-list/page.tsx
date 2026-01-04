import AppLayout from "@/components/AppLayout";
import TaskList from "@/components/dashboard/TaskList";

export default function TaskListPage() {
    return (
        <AppLayout
            title="Task List"
            description="Manage your daily tasks and to-dos."
        >
            <TaskList />
        </AppLayout>
    );
}
