#!/usr/bin/env bash
# One-time setup + push for github.com/nezuko-afk/sprintailab (macOS or Linux).
#   - creates an SSH key if you have none for GitHub (never overwrites one)
#   - registers it with GitHub (via the GitHub CLI if possible, else guided paste)
#   - switches the remote to SSH, pushes main, verifies
# Run from anywhere:  bash scripts/publish-to-github.sh
# It never asks for or stores your GitHub password or token; GitHub CLI login
# happens in your browser.
set -euo pipefail

GH_USER="${GH_USER:-nezuko-afk}"
REPO="${REPO:-sprintailab}"
EMAIL="${GIT_EMAIL:-$(git config --global user.email || true)}"
KEY="$HOME/.ssh/id_ed25519_github_${GH_USER}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS="$(uname -s)"

say() { printf '\n==> %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1; }

need git || { echo "git is required. Install it first (macOS: xcode-select --install)."; exit 1; }
need ssh-keygen || { echo "ssh-keygen is required (OpenSSH)."; exit 1; }
[ -d "$REPO_DIR/.git" ] || { echo "Not a git repository: $REPO_DIR"; exit 1; }

if [ -z "$EMAIL" ]; then
  read -r -p "Email to label the SSH key (any email you own): " EMAIL
fi

say "1/6 SSH key"
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
if [ -f "$KEY" ]; then
  echo "Using existing key $KEY"
else
  ssh-keygen -t ed25519 -C "$EMAIL" -f "$KEY"   # prompts for an optional passphrase (recommended)
fi
chmod 600 "$KEY"

say "2/6 ssh-agent and ~/.ssh/config"
eval "$(ssh-agent -s)" >/dev/null
CONFIG="$HOME/.ssh/config"; touch "$CONFIG"; chmod 600 "$CONFIG"
if ! grep -q "Host github.com-${GH_USER}" "$CONFIG"; then
  {
    echo ""
    echo "Host github.com-${GH_USER}"
    echo "  HostName github.com"
    echo "  User git"
    echo "  IdentityFile $KEY"
    echo "  IdentitiesOnly yes"
    [ "$OS" = "Darwin" ] && printf '  AddKeysToAgent yes\n  UseKeychain yes\n'
  } >> "$CONFIG"
  echo "Added host alias github.com-${GH_USER}"
fi
if [ "$OS" = "Darwin" ]; then ssh-add --apple-use-keychain "$KEY" || ssh-add "$KEY"; else ssh-add "$KEY"; fi

say "3/6 Register the public key with GitHub"
TITLE="$(hostname -s)-$(date +%Y%m%d)"
registered=0
if ! need gh && [ "$OS" = "Darwin" ] && need brew; then
  read -r -p "GitHub CLI (gh) not found. Install with Homebrew? [y/N] " a
  [[ "$a" =~ ^[Yy]$ ]] && brew install gh || true
fi
if need gh; then
  if ! gh auth status >/dev/null 2>&1; then
    echo "Opening browser login. Sign in as ${GH_USER} when asked."
    gh auth login --hostname github.com --git-protocol ssh --web --scopes admin:public_key
  elif ! gh auth status 2>&1 | grep -q "admin:public_key"; then
    gh auth refresh -h github.com -s admin:public_key
  fi
  if gh ssh-key add "${KEY}.pub" --title "$TITLE"; then registered=1; fi
fi
if [ "$registered" -eq 0 ]; then
  echo "Manual step: add the key in your browser (signed in as ${GH_USER})."
  if   need pbcopy;  then pbcopy  < "${KEY}.pub"; echo "Public key copied to clipboard."
  elif need xclip;   then xclip -selection clipboard < "${KEY}.pub"; echo "Public key copied to clipboard."
  else echo "Copy this public key:"; cat "${KEY}.pub"; fi
  URL="https://github.com/settings/ssh/new"
  { need open && open "$URL"; } || { need xdg-open && xdg-open "$URL"; } || echo "Open: $URL"
  echo "Title: $TITLE   Type: Authentication Key   Key: paste, then Add SSH key."
  read -r -p "Press Enter when the key is added... " _
fi

say "4/6 Test SSH access"
ssh -o StrictHostKeyChecking=accept-new -T "git@github.com-${GH_USER}" 2>&1 | tee /tmp/ghssh.$$ || true
grep -q "Hi ${GH_USER}!" /tmp/ghssh.$$ || { rm -f /tmp/ghssh.$$; echo "SSH did not authenticate as ${GH_USER}. Check the key was added to that account."; exit 1; }
rm -f /tmp/ghssh.$$

say "5/6 Point the remote at SSH"
cd "$REPO_DIR"
git remote remove origin 2>/dev/null || true
git remote add origin "git@github.com-${GH_USER}:${GH_USER}/${REPO}.git"
git branch -M main
git remote -v

say "6/6 Push"
git push -u origin main
echo ""
echo "Done: https://github.com/${GH_USER}/${REPO}"
echo "Note: the repo has a submodule (upstream/rea) pointing to the public REA repo; it is pushed as a link, not copied."
