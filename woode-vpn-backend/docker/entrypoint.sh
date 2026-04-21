#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set"
  exit 1
fi

echo "Running Prisma migrations..."
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  attempt=1
  max_attempts=20

  until ./node_modules/.bin/prisma migrate deploy; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "Prisma migrate deploy failed after $max_attempts attempts"
      exit 1
    fi

    echo "Migration failed, retrying ($attempt/$max_attempts)..."
    attempt=$((attempt + 1))
    sleep 3
  done
else
  echo "No Prisma migrations found, applying schema with prisma db push..."
  ./node_modules/.bin/prisma db push --skip-generate
fi

echo "Starting NestJS app..."
exec node dist/main
