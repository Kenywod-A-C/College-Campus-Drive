"""Starter prompts shown in the UI. They are only text the user can click to send; every answer still comes from the model and the tools."""
from ...models import User

STUDENT = [
    "Generate my placement report",
    "Show a chart of my applications by status", "Show a chart of how many open jobs I am eligible for",
    "Which jobs am I eligible for?", "Why am I not eligible for a job I'm interested in?", "What is the status of my applications?", "Do I have any interviews coming up?",
    "What offers do I have, and by when must I respond?", "Recommend jobs that match my skills and interests", "What do the latest placement circulars say?",
    "Remind me a day before the next deadline to update my resume",
]
FACULTY = [
    "Generate a placement summary report", "Generate a student directory report for CSE", "Add a new company",
    "Show a pie chart of placed vs unplaced students", "Show offers by department as a bar chart", "Show monthly applications and offers as a line chart",
    "List students with a CGPA above 8", "Which students are eligible for our latest open job?", "Summarise applicants by stage for the jobs I manage", "What interviews are scheduled this week?",
    "How are offers distributed by department?", "What does the latest company circular say?", "Which hiring drives need attention?",
]
ADMIN = [
    "Generate a placement summary report", "Create a faculty account", "Show and update the placement policies", "Add a new company",
    "Show a pie chart of placed vs unplaced students", "Show placement rate by department as a bar chart", "Show monthly applications and offers as a line chart",
    "List all students with their placement status", "Show the faculty accounts", "Give me an overview of placement statistics", "What are the current placement policies?", "Summarise recruitment activity and trends", "Are there any administrative alerts?",
    "Show recent denied access attempts", "How are offers distributed by department?",
]


def for_user(user: User) -> list[str]:
    items = {"student": STUDENT, "faculty": FACULTY, "admin": ADMIN}[user.role_name]
    skip = set()
    if not user.has_permission("students.view"):
        skip |= {"List students with a CGPA above 8", "List all students with their placement status"}
    if not (user.has_permission("students.view") or user.has_permission("reports.view")):
        skip.add("Show a pie chart of placed vs unplaced students")
    if not user.has_permission("reports.view"):
        skip |= {"Show offers by department as a bar chart", "Show placement rate by department as a bar chart", "Show monthly applications and offers as a line chart"}
    if not user.has_permission("reports.view"):
        skip.add("Generate a placement summary report")
    if not user.has_permission("students.view"):
        skip.add("Generate a student directory report for CSE")
    if not user.has_permission("companies.manage"):
        skip.add("Add a new company")
    if not user.has_permission("policies.manage"):
        skip.add("Show and update the placement policies")
    if not user.has_permission("users.manage"):
        skip.add("Create a faculty account")
    if not user.has_permission("users.manage"):
        skip.add("Show the faculty accounts")
    if not user.has_permission("audit.view"):
        skip.add("Show recent denied access attempts")
    if not (user.has_permission("reports.view") or user.has_permission("applications.review")):
        skip |= {"Give me an overview of placement statistics", "Summarise recruitment activity and trends"}
    return [s for s in items if s not in skip]
