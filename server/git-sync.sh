# shellcheck shell=bash
# server/git-sync.sh — the ONE way the capture machine pulls master. Sourced (not executed) by
# pipeline.sh, publish.sh, deploy-on-merge.sh and capture.sh, from the repository root.
#
# WHY A SHARED FILE (2026-10-08). Every script used to pull on its own, most of them with
# `git pull --rebase --autostash … || true`. The machine keeps local changes to TRACKED ledgers it
# writes during the night (runner/driver-triage.json, runner/eval-scores.json), and when master
# changed the same file the autostash re-apply collided and git wrote
#     <<<<<<< Updated upstream … ======= … >>>>>>> Stashed changes
# into it. Nothing noticed: publish.sh `git add`ed the file and the 2026-10-05 board (#335) carried
# the markers to master. From then on every run pulled a driver-triage.json that is not JSON, and
# balance.mjs and healthcheck.mjs both crashed parsing it — capture produced nothing on 10-06,
# 10-07 and 10-08 while the run still "finished". sync_master now always ends in heal_conflicts,
# and verify-data.js refuses to publish a tree that still holds markers.

type say >/dev/null 2>&1 || say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# A merge-conflict marker at the start of a line. `=======` alone is left out on purpose: Markdown
# and generated text use it legitimately; the opening and closing markers never appear otherwise.
CONFLICT_MARKER_RE='^(<<<<<<<|>>>>>>>) '

# heal_conflicts — leave NO conflict in the working tree, whatever produced it.
#   1. unmerged paths (a stash re-apply that collided): keep the LOCAL side — the stash holds what
#      this machine wrote tonight, which is newer than master's copy — or master's if that fails;
#   2. any tracked file that still carries markers: restore master's copy, unless master's copy is
#      itself broken (then it is reported, and verify-data.js blocks the publish).
heal_conflicts() {
  local f healed=0
  for f in $(git diff --name-only --diff-filter=U 2>/dev/null); do
    git checkout --theirs -- "$f" >/dev/null 2>&1 || git checkout HEAD -- "$f" >/dev/null 2>&1 || true
    healed=$((healed+1))
  done
  git reset -q >/dev/null 2>&1 || true
  for f in $(git grep -lE "$CONFLICT_MARKER_RE" -- . ':!*.md' 2>/dev/null); do
    if git show "HEAD:$f" 2>/dev/null | grep -qE "$CONFLICT_MARKER_RE"; then
      say "WARN $f carries conflict markers on master itself — the publish gate will refuse it"
      continue
    fi
    git checkout HEAD -- "$f" >/dev/null 2>&1 && healed=$((healed+1)) \
      && say "healed $f: conflict markers left by a stash restore — kept master's copy"
  done
  [ "$healed" -gt 0 ] && say "heal_conflicts: resolved $healed path(s)"
  return 0
}

# sync_master — pull master WITHOUT silently giving up.
#
# WHY (2026-09-04): every pull site here was `git pull --rebase --autostash … || true`, and the
# machine sat 12 commits behind master for days while every run looked healthy. --autostash stashes
# TRACKED modifications only; this machine also holds UNTRACKED capture files, and when master
# carries a file of the same name git aborts with "untracked working tree files would be overwritten
# … Aborting". The `|| true` swallowed it, so fixes pushed to master never reached the worker.
#
# Captures are the product, so nothing here deletes them: stash INCLUDING untracked, pull, restore.
# Do NOT call this while capture is writing files: the stash briefly removes untracked captures
# from the working tree.
sync_master() {
  local before after stashed=0
  before=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    git stash push -u -q -m "pipeline-prepull-$(date -u +%s)" >/dev/null 2>&1 && stashed=1
  fi
  if git pull --rebase origin master >/dev/null 2>&1; then
    after=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
    [ "$before" != "$after" ] && say "synced master $before -> $after" || true
  else
    git rebase --abort >/dev/null 2>&1 || true
    say "WARN sync_master: pull failed, staying on $before (behind $(git rev-list --count HEAD..origin/master 2>/dev/null || echo '?') commits)"
  fi
  if [ "$stashed" = "1" ]; then
    if ! git stash pop -q >/dev/null 2>&1; then
      # The pop collided with a file master now carries. Untracked files stashed with -u live in
      # the stash's third parent, so that is where a local capture has to be recovered from —
      # `git checkout stash@{0} -- .` reads the TRACKED tree and silently restores nothing.
      local restored=0 kept=0 f
      for f in $(git show --name-only --pretty=format: "stash@{0}^3" 2>/dev/null); do
        if git cat-file -e "HEAD:$f" 2>/dev/null; then
          kept=$((kept+1))          # master already carries this conversation; its copy stands
        else
          git checkout "stash@{0}^3" -- "$f" >/dev/null 2>&1 && restored=$((restored+1))
        fi
      done
      heal_conflicts
      git stash drop -q >/dev/null 2>&1 || true
      say "sync_master: stash restore collided — restored $restored local capture(s), $kept already on master"
    fi
  fi
  heal_conflicts
}
