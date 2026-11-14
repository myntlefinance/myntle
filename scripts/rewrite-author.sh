#!/bin/sh
# Rewrites every commit in the current branch with a new author and committer
# identity, preserving the tree, the message, and the dates of each commit.
#
# DANGER: this rewrites published history. It refuses to run on main, on a
# dirty working tree, or without explicit confirmation, and it preserves
# merge topology instead of flattening it.
#
# Usage: sh scripts/rewrite-author.sh <name> <email>

set -eu

name=${1:?Usage: sh scripts/rewrite-author.sh <name> <email>}
email=${2:?Usage: sh scripts/rewrite-author.sh <name> <email>}

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  echo "Refusing to rewrite history on $branch. Run on a feature branch." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to rewrite history with uncommitted changes. Commit or stash first." >&2
  exit 1
fi
printf 'Rewrite every commit on %s as "%s <%s>"? [y/N] ' "$branch" "$name" "$email"
read -r confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "Aborted."
  exit 1
fi

TMPMSG=$(mktemp)
trap 'rm -f "$TMPMSG"' EXIT INT TERM

old_head=$(git rev-parse HEAD)
new_head=

for sha in $(git rev-list --reverse --topo-order HEAD); do
  tree=$(git rev-parse "$sha^{tree}")
  author_date=$(git log -1 --format=%aI "$sha")
  committer_date=$(git log -1 --format=%cI "$sha")

  # The message is everything after the first blank line of the raw commit.
  git cat-file commit "$sha" | sed '1,/^$/d' > "$TMPMSG"

  # Linear history only: a merge commit would lose parents if flattened,
  # so abort instead.
  parent_count=$(git log -1 --format=%P "$sha" | wc -w | tr -d ' ')
  if [ "$parent_count" -gt 1 ]; then
    echo "Aborting: merge commit $sha would lose parents. Rewrite manually." >&2
    exit 1
  fi

  if [ -z "$new_head" ]; then
    new_head=$(GIT_AUTHOR_NAME="$name" \
      GIT_AUTHOR_EMAIL="$email" \
      GIT_AUTHOR_DATE="$author_date" \
      GIT_COMMITTER_NAME="$name" \
      GIT_COMMITTER_EMAIL="$email" \
      GIT_COMMITTER_DATE="$committer_date" \
      git commit-tree "$tree" < "$TMPMSG")
  else
    new_head=$(GIT_AUTHOR_NAME="$name" \
      GIT_AUTHOR_EMAIL="$email" \
      GIT_AUTHOR_DATE="$author_date" \
      GIT_COMMITTER_NAME="$name" \
      GIT_COMMITTER_EMAIL="$email" \
      GIT_COMMITTER_DATE="$committer_date" \
      git commit-tree "$tree" -p "$new_head" < "$TMPMSG")
  fi
done

current_ref=$(git symbolic-ref -q HEAD)
git update-ref "$current_ref" "$new_head" "$old_head"

echo "old head: $old_head"
echo "new head: $new_head"
