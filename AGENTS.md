# Project Architecture Rules

- Keep external CRM retry business logic in a server-only helper shared by authenticated server functions and the public API route, so both admin and client actions enforce identical checks.