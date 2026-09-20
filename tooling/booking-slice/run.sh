#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
action="${1:-up}"
project="${CHAIRLY_SLICE_PROJECT:-chairly-booking-slice}"
case "$action" in
  up|test|down) ;;
  *) echo 'Usage: bash tooling/booking-slice/run.sh [up|test|down]' >&2; exit 2 ;;
esac
step="checking Docker prerequisites"
trap 'printf "\nBooking slice FAILED: %s (exit %s).\nInspect: docker compose -p chairly-booking-slice -f compose.booking-slice.yml logs --tail=80\nFix the reported problem, then rerun this command. Reset instructions are in README.md.\n" "$step" "$?" >&2' ERR
# Bound the host Docker client as well as commands inside the container.
# Poll the actual command: a second background watchdog can race with a fast
# failure and leave orphan sleeps holding captured test output open.
bounded() {
  local limit="$1" command_pid status=0 started_at=$SECONDS timed_out=false
  shift
  "$@" &
  command_pid=$!
  while kill -0 "$command_pid" 2>/dev/null; do
    if (( SECONDS - started_at >= limit )); then
      printf '\nBooking slice timed out after %s seconds: %s. Check Docker/network availability.\n' "$limit" "$step" >&2
      timed_out=true
      kill -TERM "$command_pid" 2>/dev/null || true
      for _ in {1..50}; do
        kill -0 "$command_pid" 2>/dev/null || break
        sleep 0.1
      done
      kill -KILL "$command_pid" 2>/dev/null || true
      break
    fi
    sleep 0.1
  done
  wait "$command_pid" || status=$?
  if [[ "$timed_out" == true ]]; then return 124; fi
  return "$status"
}
run_step() {
  step="$1"
  shift
  printf '\nBooking slice: %s\n' "$step"
  bounded "$@"
}
command -v docker >/dev/null || {
  echo 'Booking slice FAILED: Docker is missing. Install Docker with Compose v2.20+ and start its engine, then retry.' >&2
  exit 1
}
run_step 'checking Docker Compose (requires v2.20+)' 15 docker compose version
run_step 'checking Docker engine access; start Docker if unavailable' 15 docker info >/dev/null
compose=(docker compose --env-file /dev/null -p "$project" -f compose.booking-slice.yml)
case "$action" in
  down)
    run_step "removing this slice's containers and database volume" 60 "${compose[@]}" down --volumes --remove-orphans
    echo 'Booking slice removed, including all appointments and local sign-in state.'
    ;;
  up|test)
    started=$SECONDS
    if [[ "$action" == up ]]; then
      run_step 'building the app and browser dependencies' 480 "${compose[@]}" build
      run_step 'starting PostgreSQL, migrations, seed, sign-in, and app (180 second readiness limit)' 240 "${compose[@]}" up -d --wait --wait-timeout 180
    fi
    run_step 'validating database configuration and applying migrations again' 195 "${compose[@]}" exec -T slice timeout 180 pnpm db:migrate:test
    for check in format:check lint typecheck test; do
      run_step "pnpm $check" 195 "${compose[@]}" exec -T slice timeout 180 pnpm "$check"
    done
    run_step 'resetting disposable demo appointments for repeatable browser tests' 75 "${compose[@]}" exec -T slice timeout 60 pnpm --filter @chairly/database exec tsx src/booking-slice-seed.ts --reset-appointments
    run_step 'four real booking browser scenarios (validation, happy path, tenant isolation, duplicate)' 255 "${compose[@]}" exec -T slice timeout 240 pnpm --filter @chairly/e2e exec playwright test --config playwright.slice.config.ts
    run_step 'existing browser regression suite' 315 "${compose[@]}" run --rm --no-deps -T slice timeout 300 pnpm test:e2e
    elapsed=$((SECONDS-started))
    printf '\nBooking slice PASSED in %s seconds.\nCustomer: http://127.0.0.1:3310/luma-studio\nOwner: http://127.0.0.1:3310/sign-in (password: booking-demo)\n' "$elapsed"
    if (( elapsed >= 600 )); then
      echo 'Booking slice timing target MISSED: setup and checks took at least 10 minutes. Record download/build timings before accepting this setup.' >&2
    fi
    ;;
esac
