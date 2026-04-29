# Project Structure

## app/
Frontend application. React/Vite UI lives here.

## api/
Backend/server-side logic goes here. Use this for service-role Supabase calls, AI runners, cron jobs, and private API routes.

## data/
Database schema, seed files, sample data, and reproducibility assets.

## docs/
Product strategy, PRDs, architecture notes, market research, and decisions.

## agents/
Role-based AI agent definitions. Each agent should include role, inputs, outputs, constraints, and evaluation criteria.

## prompts/
Reusable prompt templates used by agents or workflows.

## CLAUDE.md
Project-specific instructions for Claude/Cursor.

## CONTEXT.md
Product context, goals, users, assumptions, and active priorities.

## SETUP.md
How to run the project locally.