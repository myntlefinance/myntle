#!/bin/sh
# Rewrites every commit in the current branch with a new author and committer
# identity, preserving the tree, the message, and the dates of each commit.
#
# It uses commit-tree rather than rebase or filter-branch, because both of
# those refuse to run with a dirty working tree, and this repository has
# uncommitted work in it that must not be disturbed.
#
# Usage: sh scripts/rewrite-author.sh <name> <email>

set -eu

name=$1
email=$2

old_head=$(git rev-parse HEAD)
new_head=

for sha in $(git rev-list --reverse HEAD); do
  tree=$(git rev-parse "$sha^{tree}")
  author_date=$(git log -1 --format=%aI "$sha")
  committer_date=$(git log -1 --format=%cI "$sha")

  # The message is everything after the first blank line of the raw commit.
  git cat-file commit "$sha" | sed '1,/^$/d' > "$TMPMSG"

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

git update-ref refs/heads/main "$new_head" "$old_head"

echo "old head: $old_head"
echo "new head: $new_head"
