---
title: What Jtzt Is
description: A focused working-hours system for companies that want local control.
excerpt: Jtzt gives each company its own database, keeps the product simple, and stays fast enough for daily use.
order: 1
---

# Working hours without software noise

Jtzt is a multi-tenant working-hours system built for internal company use.

Every company gets its own SQLite database. That keeps data separated, easy to reason about, and simple to move or back up.

## Why it feels different

- It is local-first and lightweight.
- It does not depend on a large cloud platform.
- It keeps the product structure readable for teams and AI agents.

## What people do inside it

- Employees sign in and track time.
- Company admins manage users, projects, and tasks.
- System admins create and maintain companies.

## Why the architecture matters

Jtzt is designed so the codebase stays extendable. Frontend pages are small. Backend routes stay thin. Business logic lives in services. Shared types stay explicit.

That means the product can grow without turning into a maze.
