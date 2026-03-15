import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const links = [
  {
    to: "/settings/users",
    title: "Users",
    description: "Review all tenant users, including company admins."
  },
  {
    to: "/settings/users/create",
    title: "Create user",
    description: "Add an employee or another company admin."
  },
  {
    to: "/projects",
    title: "Projects and tasks",
    description: "Manage company projects and their task lists."
  }
];

export function SettingsMenuPage() {
  return (
    <div className="space-y-6">
      {links.map((item) => (
        <Link key={item.to} to={item.to} className="block">
          <Card>
            <CardHeader>
              <CardTitle>{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{item.description}</CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
