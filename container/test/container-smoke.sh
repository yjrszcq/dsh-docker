#!/bin/sh
set -eu

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [image]" >&2
  exit 64
fi

image="${1:-dsh-docker:smoke}"
container="dsh-gateway-smoke-$$"
platform_volume="dsh-platform-smoke-$$"
home_volume="dsh-home-smoke-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$platform_volume" "$home_volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

wait_platform_ready() {
  started="$(date +%s%3N)"
  while ! docker exec "$container" sh -c '
    curl --fail --silent http://127.0.0.1:3080/_dsh_gateway/health >/dev/null \
      && curl --fail --silent --noproxy "*" http://127.0.0.1:3079/ >/dev/null \
      && dsh-platform status | jq -e '\''.dshLifecycle.state == "running"'\'' >/dev/null
  ' >/dev/null 2>&1; do
    now="$(date +%s%3N)"
    if [ $((now - started)) -ge 10000 ]; then
      docker logs "$container" >&2
      echo "platform readiness exceeded 10 seconds" >&2
      exit 1
    fi
    sleep 0.2
  done
  now="$(date +%s%3N)"
  echo "$((now - started))"
}

if [ "$#" -eq 0 ]; then
  docker build --tag "$image" .
fi

docker run --detach --name "$container" \
  --group-add dsh-sudo-false \
  --env DSH_PROXY_USERNAME=smoke-user \
  --env DSH_PROXY_PASSWORD=smoke-password \
  --env DSH_TRUSTED_HOSTS=smoke.example \
  --volume "$platform_volume:/data/platform" \
  --volume "$home_volume:/data/dsh" \
  "$image" >/dev/null

startup_one="$(wait_platform_ready)"
if docker exec --user node "$container" sudo -n true >/dev/null 2>&1; then
  echo "DSH node identity unexpectedly retained sudo while DSH_SUDO_ENABLED=false" >&2
  exit 1
fi
status="$(docker exec --user node "$container" curl --silent --output /dev/null --write-out '%{http_code}' \
  --unix-socket /run/dsh-platform/maintenance.sock \
  http://localhost/_dsh_platform/api/v1/files/config)"
[ "$status" = 401 ]
attempt=0
until docker logs "$container" 2>&1 \
  | grep -E '"source":"bootstrap".*"stream":"platform".*"message":"platform.ready"' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 50 ] || exit 1
  sleep 0.2
done
docker logs "$container" 2>&1 \
  | grep -E '"source":"stage0".*"stream":"platform".*"message":"stage0.ready"' >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' 'http://127.0.0.1:3080/_dsh_platform/api/v1/logs?limit=5000' \
  | jq -e 'any(.entries[]; .source == "stage0" and .message == "stage0.ready")
    and any(.entries[]; .source == "bootstrap" and .message == "platform.ready")
    and any(.entries[]; .source == "gateway" and .message == "gateway.ready")' >/dev/null

docker exec "$container" sh -c '
  set -eu
  command -v g++ >/dev/null
  command -v make >/dev/null
  command -v python3 >/dev/null
  venv="$(mktemp -d)/venv"
  python3 -m venv "$venv"
  "$venv/bin/python" -c "import sys; assert sys.prefix != sys.base_prefix"
  "$venv/bin/pip" --version >/dev/null
'

sh "$(dirname "$0")/profile-package-compatibility-smoke.sh" "$container"

status="$(docker exec "$container" curl --silent --output /dev/null --write-out '%{http_code}' \
  --header 'Host: evil.example' http://127.0.0.1:3080/)"
[ "$status" = 403 ]

status="$(docker exec "$container" curl --silent --output /dev/null --write-out '%{http_code}' \
  --header 'Accept: text/html' --header 'Host: smoke.example' http://127.0.0.1:3080/)"
[ "$status" = 401 ]

status="$(docker exec "$container" curl --silent --output /dev/null --write-out '%{http_code}' \
  --user 'wrong-user:smoke-password' --header 'Host: smoke.example' \
  http://127.0.0.1:3080/)"
[ "$status" = 401 ]

docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/ >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/console/ \
  | grep -F 'DSH Management Console' >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e '.updateChannel == "stable"
    and .automaticCheck == {"enabled":true,"intervalSeconds":21600,"notificationsEnabled":true}
    and .latestAutomatic == {"stable":null,"upstream":null}' >/dev/null

docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/bundled-plugins \
  | jq -e '.plugins == [{
    "id":"platform-management",
    "artifactId":"system-plugin-platform-management",
    "sha256":.plugins[0].sha256,
    "description":{"zh":"管理 DSH Docker 更新、运行维护、系统插件与系统技能。","en":"Manage DSH Docker updates, runtime maintenance, System Plugins, and System Skills."},
    "installed":true,
    "enabled":true,
    "activeInstalled":true,
    "activeEnabled":true,
    "pendingRestart":false,
    "protected":true,
    "reason":null
  },{
    "id":"settings-document-editor",
    "artifactId":"system-plugin-settings-document-editor",
    "sha256":.plugins[1].sha256,
    "description":{"zh":"在浏览器中查看和编辑 DSH 配置文件。","en":"View and edit the DSH settings document in the browser."},
    "installed":true,
    "enabled":true,
    "activeInstalled":true,
    "activeEnabled":true,
    "pendingRestart":false,
    "protected":false,
    "reason":null
  }]' >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/system-skills \
  | jq -e '.skills == [{
    "id":"dsh-docker-operations",
    "sha256":.skills[0].sha256,
    "description":{"zh":"在 DSH Docker 环境中使用受支持的命令完成开发、插件、维护、更新、恢复与诊断。","en":"Use supported commands for development, plugins, maintenance, updates, recovery, and diagnostics in the DSH Docker Environment."},
    "installed":true,
    "enabled":true
  }]' >/dev/null
skill_view="/run/dsh-platform/views/skills/dsh-docker-operations"
docker exec "$container" sh -c "test -L '$skill_view' && test -f '$skill_view/SKILL.md'"
docker exec -i --user node \
  --env DSH_HOME=/data/dsh \
  --env DSH_DEFAULT_WORKSPACE=/workspace \
  --env DSH_BUNDLED_SKILL_DIR=/run/dsh-platform/views/skills \
  "$container" /usr/local/bin/node --input-type=module \
  < "$(dirname "$0")/system-skill-discovery-smoke.mjs" \
  | jq -e '.name == "dsh-docker-operations" and .source == "bundled" and .provider == "filesystem" and .contentBytes > 500' >/dev/null
skill_dsh_pid="$(docker exec "$container" pgrep -o -f '^node /run/dsh-platform/views/runtime/bin/dsh web ' )"
skill_task="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --header 'Content-Type: application/json' \
  --data '{"skillId":"dsh-docker-operations","action":"disable"}' \
  http://127.0.0.1:3080/_dsh_platform/api/v1/system-skills/action | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$skill_task" '.systemSkillOperation.taskId == $task and .systemSkillOperation.status == "success"' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 0.1
done
if docker exec "$container" test -e "$skill_view"; then
  echo "disabled System Skill remained in the active view" >&2
  exit 1
fi
[ "$skill_dsh_pid" = "$(docker exec "$container" pgrep -o -f '^node /run/dsh-platform/views/runtime/bin/dsh web ' )" ]
skill_task="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --header 'Content-Type: application/json' \
  --data '{"skillId":"dsh-docker-operations","action":"enable"}' \
  http://127.0.0.1:3080/_dsh_platform/api/v1/system-skills/action | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$skill_task" '.systemSkillOperation.taskId == $task and .systemSkillOperation.status == "success"' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 0.1
done
docker exec "$container" sh -c "test -L '$skill_view' && test -f '$skill_view/SKILL.md'"
docker logs "$container" 2>&1 | grep -E '"source":"audit".*"message":"system-skill.disable.completed"' >/dev/null
docker logs "$container" 2>&1 | grep -E '"source":"audit".*"message":"system-skill.enable.completed"' >/dev/null
docker exec -i --user node \
  --env DSH_HOME=/data/dsh \
  --env DSH_DEFAULT_WORKSPACE=/workspace \
  --env DSH_BUNDLED_SKILL_DIR=/run/dsh-platform/views/skills \
  "$container" /usr/local/bin/node --input-type=module \
  < "$(dirname "$0")/user-skill-watcher-smoke.mjs" \
  | jq -e '. == {"discovered":true,"disabled":true,"enabled":true,"deleted":true}' >/dev/null
docker exec --user node "$container" sh -c '
  set -eu
  skill=/data/dsh/skills/smoke-managed-user-skill
  mkdir -p "$skill"
  cat > "$skill/SKILL.md" <<"EOF"
---
name: smoke-managed-user-skill
description: Smoke-test Management user skill actions.
---

# Smoke Managed User Skill
EOF
'
user_skill_inventory="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/user-skills)"
user_skill_id="$(echo "$user_skill_inventory" | jq -er '.skills[] | select(.name == "smoke-managed-user-skill") | .entryId')"
user_skill_revision="$(echo "$user_skill_inventory" | jq -er .revision)"
user_skill_dsh_pid="$(docker exec "$container" pgrep -o -f '^node /run/dsh-platform/views/runtime/bin/dsh web ' )"
user_skill_task="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --header 'Content-Type: application/json' \
  --data "$(jq -nc --arg entryId "$user_skill_id" --arg revision "$user_skill_revision" \
    '{entryId:$entryId,revision:$revision,action:"disable"}')" \
  http://127.0.0.1:3080/_dsh_platform/api/v1/user-skills/action | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$user_skill_task" '.userSkillOperation.taskId == $task and .userSkillOperation.status == "success"' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 0.1
done
docker exec "$container" test -f /data/dsh/skills/.disabled/smoke-managed-user-skill/SKILL.md
[ "$user_skill_dsh_pid" = "$(docker exec "$container" pgrep -o -f '^node /run/dsh-platform/views/runtime/bin/dsh web ' )" ]
user_skill_inventory="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/user-skills)"
user_skill_id="$(echo "$user_skill_inventory" | jq -er '.skills[] | select(.name == "smoke-managed-user-skill") | .entryId')"
user_skill_revision="$(echo "$user_skill_inventory" | jq -er .revision)"
user_skill_task="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --header 'Content-Type: application/json' \
  --data "$(jq -nc --arg entryId "$user_skill_id" --arg revision "$user_skill_revision" \
    '{entryId:$entryId,revision:$revision,action:"enable"}')" \
  http://127.0.0.1:3080/_dsh_platform/api/v1/user-skills/action | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$user_skill_task" '.userSkillOperation.taskId == $task and .userSkillOperation.status == "success"' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 0.1
done
docker exec "$container" test -f /data/dsh/skills/smoke-managed-user-skill/SKILL.md
[ "$user_skill_dsh_pid" = "$(docker exec "$container" pgrep -o -f '^node /run/dsh-platform/views/runtime/bin/dsh web ' )" ]
user_skill_inventory="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/user-skills)"
user_skill_id="$(echo "$user_skill_inventory" | jq -er '.skills[] | select(.name == "smoke-managed-user-skill") | .entryId')"
user_skill_revision="$(echo "$user_skill_inventory" | jq -er .revision)"
user_skill_task="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --header 'Content-Type: application/json' \
  --data "$(jq -nc --arg entryId "$user_skill_id" --arg revision "$user_skill_revision" \
    '{entryId:$entryId,revision:$revision,action:"delete"}')" \
  http://127.0.0.1:3080/_dsh_platform/api/v1/user-skills/action | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$user_skill_task" '.userSkillOperation.taskId == $task and .userSkillOperation.status == "success"' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 0.1
done
if docker exec "$container" test -e /data/dsh/skills/smoke-managed-user-skill; then
  echo "deleted User Skill remained in the active user root" >&2
  exit 1
fi
[ "$user_skill_dsh_pid" = "$(docker exec "$container" pgrep -o -f '^node /run/dsh-platform/views/runtime/bin/dsh web ' )" ]
docker logs "$container" 2>&1 | grep -E '"source":"audit".*"message":"user-skill.disable.completed"' >/dev/null
docker logs "$container" 2>&1 | grep -E '"source":"audit".*"message":"user-skill.enable.completed"' >/dev/null
docker logs "$container" 2>&1 | grep -E '"source":"audit".*"message":"user-skill.delete.completed"' >/dev/null
settings_document="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/settings-document)"
[ "$(echo "$settings_document" | jq -r .exists)" = false ]
settings_revision="$(echo "$settings_document" | jq -r .revision)"
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --header 'Content-Type: application/json' --request PUT \
  --data "$(jq -nc --arg revision "$settings_revision" '{content:"{}\n",revision:$revision}')" \
  http://127.0.0.1:3080/_dsh_platform/api/v1/settings-document \
  | jq -e '.content == "{}\n" and .exists == true' >/dev/null
docker exec "$container" sh -c '
  [ "$(cat /data/dsh/settings.yaml)" = "{}" ]
  [ "$(stat -c %U /data/dsh/settings.yaml)" = node ]
  grep -F "@dsh-docker/settings-document-editor" /run/dsh-platform/views/system-plugins/cordis.patch.yml >/dev/null
'
dsh_pid_before_plugin_changes="$(docker exec "$container" pgrep -f '^node /run/dsh-platform/views/runtime/bin/dsh web')"
plugin_task="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --header 'Content-Type: application/json' \
  --data '{"id":"platform-management","action":"uninstall"}' \
  http://127.0.0.1:3080/_dsh_platform/api/v1/bundled-plugins/action | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$plugin_task" \
    '.systemPluginOperation.taskId == $task
      and .systemPluginOperation.status == "failed"
      and (.systemPluginOperation.error | contains("managed by the platform"))' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 50 ] || exit 1
  sleep 0.2
done
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/bundled-plugins \
  | jq -e '.plugins[0] | .installed and .enabled and .protected' >/dev/null

recovery_task="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --header 'Content-Type: application/json' \
  --data '{"id":"platform-management","action":"uninstall"}' \
  http://127.0.0.1:3080/_dsh_platform/api/v1/bundled-plugins/recovery-action | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$recovery_task" \
    '.systemPluginOperation.taskId == $task and .systemPluginOperation.status == "success"' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 0.2
done
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/console/ \
  | grep -F 'Standalone console' >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/bundled-plugins \
  | jq -e '.plugins[0] | (.installed | not) and (.enabled | not) and .protected' >/dev/null

recovery_task="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --header 'Content-Type: application/json' \
  --data '{"id":"platform-management","action":"install"}' \
  http://127.0.0.1:3080/_dsh_platform/api/v1/bundled-plugins/recovery-action | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$recovery_task" \
    '.systemPluginOperation.taskId == $task and .systemPluginOperation.status == "success"' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 0.2
done
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/bundled-plugins \
  | jq -e '.plugins[0] | .installed and .enabled and .protected' >/dev/null
plugin_task="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --header 'Content-Type: application/json' \
  --data '{"id":"settings-document-editor","action":"disable"}' \
  http://127.0.0.1:3080/_dsh_platform/api/v1/bundled-plugins/action | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$plugin_task" \
    '.systemPluginOperation.taskId == $task and .systemPluginOperation.status == "success"
      and .systemPluginOperation.restartRequired == true' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 0.2
done
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/bundled-plugins \
  | jq -e '.plugins[1] | .installed and (.enabled | not)' >/dev/null
docker exec "$container" grep -F '@dsh-docker/settings-document-editor' \
  /run/dsh-platform/views/system-plugins/cordis.patch.yml >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e '.systemPluginOperation.restartRequired == true' >/dev/null
dsh_pid_before="$(docker exec "$container" pgrep -f '^node /run/dsh-platform/views/runtime/bin/dsh web')"
[ "$dsh_pid_before_plugin_changes" = "$dsh_pid_before" ]
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --request POST \
  http://127.0.0.1:3080/_dsh_platform/api/v1/bundled-plugins/discard \
  | jq -e '.plugins[1] | .installed and .enabled and (.pendingRestart | not)' >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e '.systemPluginOperation.restartRequired == false' >/dev/null
[ "$dsh_pid_before" = "$(docker exec "$container" pgrep -f '^node /run/dsh-platform/views/runtime/bin/dsh web')" ]
plugin_task="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --header 'Content-Type: application/json' \
  --data '{"id":"settings-document-editor","action":"disable"}' \
  http://127.0.0.1:3080/_dsh_platform/api/v1/bundled-plugins/action | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$plugin_task" \
    '.systemPluginOperation.taskId == $task and .systemPluginOperation.status == "success"
      and .systemPluginOperation.restartRequired == true' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 0.2
done
restart_task="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --request POST \
  http://127.0.0.1:3080/_dsh_platform/api/v1/restart-dsh | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$restart_task" \
    '.dshLifecycle.taskId == $task and .dshLifecycle.state == "running"
      and .systemPluginOperation.restartRequired == false' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 100 ] || exit 1
  sleep 0.2
done
dsh_pid_after="$(docker exec "$container" pgrep -f '^node /run/dsh-platform/views/runtime/bin/dsh web')"
[ "$dsh_pid_before" != "$dsh_pid_after" ]
if docker exec "$container" grep -F '@dsh-docker/settings-document-editor' \
  /run/dsh-platform/views/system-plugins/cordis.patch.yml >/dev/null; then
  exit 1
fi
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/ >/dev/null
docker exec "$container" sh -c "
  grep -F '\"message\":\"component.stopping\"' /data/platform/logs/dsh-runtime.jsonl >/dev/null
  grep -F '\"message\":\"component.ready\"' /data/platform/logs/dsh-runtime.jsonl >/dev/null
  grep -F '\"message\":\"system-plugin.changes.discarded\"' /data/platform/logs/audit.jsonl >/dev/null
"

bootstrap_pid="$(docker exec "$container" pgrep -f '/platform/bootstrap/index.mjs')"
dsh_pid="$(docker exec "$container" pgrep -f '^node /run/dsh-platform/views/runtime/bin/dsh web')"
docker exec "$container" kill -9 "$dsh_pid"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e '.dshLifecycle.state == "running" and .recoveryMode == null' >/dev/null \
  && [ "$(docker exec "$container" pgrep -f '^node /run/dsh-platform/views/runtime/bin/dsh web')" != "$dsh_pid" ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 100 ] || exit 1
  sleep 0.1
done
[ "$(docker exec "$container" pgrep -f '/platform/bootstrap/index.mjs')" = "$bootstrap_pid" ]
[ "$(docker inspect --format '{{.RestartCount}}' "$container")" = 0 ]

stop_task="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --request POST \
  http://127.0.0.1:3080/_dsh_platform/api/v1/stop-dsh | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$stop_task" '.dshLifecycle.taskId == $task and .dshLifecycle.state == "stopped"' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 50 ] || exit 1
  sleep 0.1
done
sleep 1
if docker exec "$container" pgrep -f '^node /run/dsh-platform/views/runtime/bin/dsh web' >/dev/null; then
  echo "DSH recovered after an explicit stop" >&2
  exit 1
fi
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' \
  'http://127.0.0.1:3080/_dsh_gateway/wait?return=%2Fsessions%2Fcurrent' \
  | grep -F 'DeepSeek Harness is stopped' >/dev/null
docker exec -i --user node "$container" /usr/local/bin/node --input-type=module \
  < container/test/standalone-file-management-smoke.mjs \
  | jq -e '.range == "3456" and .searched >= 2 and .attributes == 488 and .dshUnavailable == true' >/dev/null
docker logs "$container" 2>&1 \
  | grep -E '"source":"file-manager".*"message":"file-task.copy.completed"' >/dev/null
docker logs "$container" 2>&1 \
  | grep -E '"source":"audit".*"message":"files.content.saved"' >/dev/null
docker logs "$container" 2>&1 \
  | grep -E '"error":"size target changed".*"source":"audit".*"message":"files.size.failed"' >/dev/null
docker logs "$container" 2>&1 \
  | grep -E '"source":"audit".*"message":"files.attributes.completed"' >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Accept: text/html' --header 'Host: smoke.example' http://127.0.0.1:3080/ >/dev/null
if docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' 'http://127.0.0.1:3080/_dsh_platform/api/v1/logs?source=gateway&limit=5000' \
  | jq -e 'any(.entries[]; .message == "gateway.upstream.failed" and .upstream == "dsh")' >/dev/null; then
  echo "explicit DSH stop was reported as an upstream failure" >&2
  exit 1
fi
managed_start_output="$(docker exec --user node "$container" dsh web --no-open)"
printf '%s\n' "$managed_start_output" | grep -F 'requested managed DSH start' >/dev/null
start_task="$(printf '%s\n' "$managed_start_output" | sed -n 's/.*(task \([^)]*\)).*/\1/p')"
[ -n "$start_task" ]
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$start_task" \
    '.dshLifecycle.taskId == $task and .dshLifecycle.state == "running" and .recoveryMode == null' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 100 ] || exit 1
  sleep 0.1
done
docker exec "$container" curl --fail --silent http://127.0.0.1:3079/ >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/ >/dev/null
if docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' 'http://127.0.0.1:3080/_dsh_platform/api/v1/logs?source=gateway&limit=5000' \
  | jq -e 'any(.entries[]; .message == "gateway.upstream.recovered" and .upstream == "dsh")' >/dev/null; then
  echo "explicit DSH start was reported as outage recovery" >&2
  exit 1
fi

docker exec -i --user node "$container" /usr/local/bin/node --input-type=module \
  < container/test/standalone-recovery-smoke.mjs \
  | jq -e '.faultNames == ["smoke-fault-one","smoke-fault-two"]' >/dev/null
docker logs "$container" 2>&1 \
  | grep -E '"source":"terminal".*"message":"terminal.session.created"' >/dev/null
docker logs "$container" 2>&1 \
  | grep -E '"source":"audit".*"message":"user-plugin.apply.failed"' >/dev/null
docker logs "$container" 2>&1 \
  | grep -E '"source":"audit".*"message":"user-plugin.apply.completed"' >/dev/null
docker exec "$container" curl --fail --silent --noproxy '*' http://127.0.0.1:3079/ >/dev/null

docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --header 'Content-Type: application/json' \
  --request PUT --data '{"enabled":false,"intervalSeconds":3600,"notificationsEnabled":false}' \
  http://127.0.0.1:3080/_dsh_platform/api/v1/automatic-check \
  | jq -e '. == {"enabled":false,"intervalSeconds":3600,"notificationsEnabled":false}' >/dev/null

loopback_patch_count="$(docker exec "$container" sh -c \
  "grep -F -o 'isLoopback: true,' /run/dsh-platform/views/runtime/package/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js | wc -l")"
[ "$loopback_patch_count" = 1 ]

docker exec "$container" sh -c '
  set -eu
  pgrep -f "^/usr/local/bin/node /opt/dsh-platform/runtime/platform/stage0/index.mjs$" >/dev/null
  pgrep -f "/opt/dsh-platform/seed/bootstrap/.*/platform/bootstrap/index.mjs" >/dev/null
  pgrep -f "^node /run/dsh-platform/views/runtime/bin/dsh web --patch /run/dsh-platform/views/system-plugins/cordis.patch.yml --host 127.0.0.1 --port 3079$" >/dev/null
  pgrep -f "^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/management/index.mjs$" >/dev/null
  pgrep -f "^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/gateway/index.mjs$" >/dev/null
  dsh-platform trust status | jq -e ".keyringGeneration == 1" >/dev/null
  dsh-platform status | jq -e ".trust.keyringGeneration == 1 and .platformLayout == 1 and .current.source == \"image\"" >/dev/null
  [ "$(stat -c %a /run/dsh-platform/recovery.sock)" = 600 ]
  [ "$(stat -c %U /run/dsh-platform/recovery.sock)" = root ]
  [ "$(readlink /usr/local/bin/dsh 2>/dev/null || true)" = "" ]
  grep -F "exec /run/dsh-platform/views/runtime/bin/dsh" /usr/local/bin/dsh >/dev/null
'

docker exec "$container" sh -c 'printf runtime-reset-smoke > /data/dsh/runtime-reset-sentinel'
docker exec "$container" cp /data/platform/state/deployments/slots.json /tmp/slots-before-runtime-reset.json
runtime_hash="$(docker exec "$container" sha256sum /run/dsh-platform/views/runtime/package/package.json | cut -d ' ' -f 1)"
docker exec "$container" sh -c 'printf "\ncorrupt-runtime-smoke" >> /run/dsh-platform/views/runtime/package/package.json'
runtime_reset_task="$(docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --request POST \
  http://127.0.0.1:3080/_dsh_platform/api/v1/runtime/reset | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$runtime_reset_task" '.runtimeReset.taskId == $task and .runtimeReset.status == "success"' >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 600 ]; then
    docker logs "$container" >&2
    echo "Runtime reset did not complete" >&2
    exit 1
  fi
  sleep 0.2
done
[ "$(docker exec "$container" sha256sum /run/dsh-platform/views/runtime/package/package.json | cut -d ' ' -f 1)" = "$runtime_hash" ]
[ "$(docker exec "$container" cat /data/dsh/runtime-reset-sentinel)" = runtime-reset-smoke ]
docker exec "$container" jq -e --slurpfile before /tmp/slots-before-runtime-reset.json \
  '.generation == ($before[0].generation + 1) and .previous == $before[0].previous' \
  /data/platform/state/deployments/slots.json >/dev/null
docker exec "$container" dsh-platform status \
  | jq -e '.current.source == "managed" and .recoveryMode == null' >/dev/null
docker logs "$container" 2>&1 | grep -E '"source":"audit".*"message":"runtime.reset.started"' >/dev/null
docker logs "$container" 2>&1 | grep -E '"source":"audit".*"message":"runtime.reset.completed"' >/dev/null

stage0_pid="$(docker exec "$container" pgrep -f '^/usr/local/bin/node /opt/dsh-platform/runtime/platform/stage0/index.mjs$')"
bootstrap_pid="$(docker exec "$container" pgrep -f '/opt/dsh-platform/seed/bootstrap/.*/platform/bootstrap/index.mjs')"
management_pid="$(docker exec "$container" pgrep -f '^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/management/index.mjs$')"
gateway_pid="$(docker exec "$container" pgrep -f '^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/gateway/index.mjs$')"
dsh_pid="$(docker exec "$container" pgrep -o -f '^node /run/dsh-platform/views/runtime/bin/dsh web ')"
docker exec --user node "$container" node -e '
  const fs = require("node:fs")
  const path = "/data/dsh/profiles/web/package.json"
  const manifest = JSON.parse(fs.readFileSync(path, "utf8"))
  manifest.dsh.profile.bundles.push("smoke-removed-plugin")
  fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n")
'
restart_task="$(docker exec "$container" dsh-platform restart | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$restart_task" '.dshLifecycle.taskId == $task and .dshLifecycle.state == "running"' >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    docker logs "$container" >&2
    echo "DSH restart did not complete" >&2
    exit 1
  fi
  sleep 0.2
done
[ "$(docker exec "$container" pgrep -f '^/usr/local/bin/node /opt/dsh-platform/runtime/platform/stage0/index.mjs$')" = "$stage0_pid" ]
[ "$(docker exec "$container" pgrep -f '/opt/dsh-platform/seed/bootstrap/.*/platform/bootstrap/index.mjs')" = "$bootstrap_pid" ]
[ "$(docker exec "$container" pgrep -f '^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/management/index.mjs$')" = "$management_pid" ]
[ "$(docker exec "$container" pgrep -f '^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/gateway/index.mjs$')" = "$gateway_pid" ]
[ "$(docker exec "$container" pgrep -o -f '^node /run/dsh-platform/views/runtime/bin/dsh web ')" != "$dsh_pid" ]
docker exec "$container" jq -e '.dsh.profile.bundles | index("smoke-removed-plugin") == null' \
  /data/dsh/profiles/web/package.json >/dev/null
docker logs "$container" 2>&1 \
  | grep -F 'dsh: removed orphaned profile bundle(s): smoke-removed-plugin' >/dev/null

dsh_pid="$(docker exec "$container" pgrep -o -f '^node /run/dsh-platform/views/runtime/bin/dsh web ')"
managed_restart_result="$(docker exec -i --user node --env CURRENT_DSH_PID="$dsh_pid" \
  "$container" /usr/local/bin/node --input-type=module \
  < "$(dirname "$0")/managed-lifecycle-restart-smoke.mjs")"
printf '%s\n' "$managed_restart_result" | jq -e \
  '.helperExitCode == 0 and .sawRestarting == true and .dshCount == 1
    and (.taskId | type == "string" and length > 0) and .oldPid != .newPid' >/dev/null
[ "$(docker exec "$container" pgrep -f '^/usr/local/bin/node /opt/dsh-platform/runtime/platform/stage0/index.mjs$')" = "$stage0_pid" ]
[ "$(docker exec "$container" pgrep -f '/opt/dsh-platform/seed/bootstrap/.*/platform/bootstrap/index.mjs')" = "$bootstrap_pid" ]
[ "$(docker exec "$container" pgrep -f '^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/management/index.mjs$')" = "$management_pid" ]
[ "$(docker exec "$container" pgrep -f '^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/gateway/index.mjs$')" = "$gateway_pid" ]
[ "$(docker exec "$container" pgrep -c -f '^node /run/dsh-platform/views/runtime/bin/dsh web ')" = 1 ]

if docker exec --user node "$container" curl --silent --unix-socket /run/dsh-platform/recovery.sock \
  http://localhost/v1/status >/dev/null 2>&1; then
  echo "node user unexpectedly accessed the Stage-0 recovery socket" >&2
  exit 1
fi

docker exec "$container" curl --fail --silent --noproxy '*' \
  http://127.0.0.1:3079/ >/dev/null

container_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container")"
if docker exec "$container" curl --fail --silent --max-time 2 --noproxy '*' \
  "http://${container_ip}:3079/" >/dev/null 2>&1; then
  echo "DSH unexpectedly accepts non-loopback connections on port 3079" >&2
  exit 1
fi

cleanup
docker run --detach --name "$container" \
  --group-add dsh-sudo-true \
  --env DSH_PROXY_USERNAME=smoke-user \
  --env DSH_PROXY_PASSWORD=smoke-password \
  --env DSH_TRUSTED_HOSTS=smoke.example \
  --volume "$platform_volume:/data/platform" \
  --volume "$home_volume:/data/dsh" \
  "$image" >/dev/null
startup_two="$(wait_platform_ready)"
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' --header 'Content-Type: application/json' \
  --request PUT --data '{"enabled":false,"intervalSeconds":3600,"notificationsEnabled":false}' \
  http://127.0.0.1:3080/_dsh_platform/api/v1/automatic-check >/dev/null
docker exec --user node "$container" sh -c 'printf platform > /data/platform/state/updater/smoke && printf home > /data/dsh/smoke'
stop_task="$(docker exec "$container" dsh-platform stop | jq -r .taskId)"
attempt=0
until docker exec "$container" dsh-platform status \
  | jq -e --arg task "$stop_task" '.dshLifecycle.taskId == $task and .dshLifecycle.state == "stopped"' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 0.2
done
docker exec "$container" chown root:root /data/platform/cache/npm
docker restart "$container" >/dev/null
startup_three="$(wait_platform_ready)"
docker exec "$container" sh -c '[ "$(stat -c %u:%g /data/platform/cache/npm)" = 1000:1000 ]'
docker exec "$container" sh -c '[ "$(cat /data/platform/state/updater/smoke)" = platform ] && [ "$(cat /data/dsh/smoke)" = home ]'
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e '.automaticCheck == {"enabled":false,"intervalSeconds":3600,"notificationsEnabled":false}
    and .dshLifecycle.state == "running"' >/dev/null
echo "Cold readiness (ms): $startup_one, $startup_two, $startup_three"

docker exec "$container" dsh-platform channel experimental >/dev/null
[ "$(docker exec "$container" dsh-platform channel)" = experimental ]
attempt=0
until docker exec --user node "$container" curl --fail --silent --unix-socket /run/dsh-platform/bootstrap.sock \
  http://localhost/v1/status >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 1
done
docker exec --user node "$container" curl --fail --silent --unix-socket /run/dsh-platform/bootstrap.sock \
  --request POST http://localhost/v1/components/dsh-runtime/suspend >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/console/ \
  | grep -F 'DSH Management Console' >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status >/dev/null
docker exec -i --user node "$container" /usr/local/bin/node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises'
import { LocalApiClient } from '/run/dsh-platform/views/bootstrap/control-plane/modules/updater/lib/client.mjs'
import { UpdateJournal } from '/run/dsh-platform/views/bootstrap/control-plane/modules/updater/lib/journal.mjs'
import { PersistentStateSnapshots } from '/run/dsh-platform/views/bootstrap/control-plane/modules/updater/lib/snapshots.mjs'

const bootstrap = new LocalApiClient('/run/dsh-platform/bootstrap.sock')
const { record } = await bootstrap.request('GET', '/v1/deployments/current')
const metadata = JSON.parse(await readFile('/run/dsh-platform/views/runtime/package/package.json', 'utf8'))
const snapshots = new PersistentStateSnapshots({ root: '/data/platform/store/snapshots', sourceRoot: '/data/dsh' })
await snapshots.create({
  id: 'smoke-recovery', runtimeId: record.id,
  environmentVersion: record.environmentVersion, dshVersion: metadata.version,
})
const journal = new UpdateJournal('/data/platform/state/updater/transaction.json')
await journal.begin({
  transactionId: 'smoke-recovery', mode: 'experimental',
  from: {
    dsh: metadata.version, environment: record.environmentVersion, runtime: record.id,
    dataSnapshot: null, receiptTokens: record.receiptTokens,
  },
  to: { dsh: metadata.version, environment: record.environmentVersion, runtime: record.id },
})
await journal.transition('candidate-ready', { receiptTokens: record.receiptTokens })
await journal.transition('suspended')
await journal.transition('snapshot-created', { snapshotId: 'smoke-recovery' })
await journal.transition('switched')
await journal.transition('probation', { probationUntil: '2099-01-01T00:00:00.000Z' })
NODE
docker exec --user node "$container" sh -c 'printf changed-after-snapshot > /data/dsh/smoke'
docker restart "$container" >/dev/null
attempt=0
until docker exec "$container" sh -c '
  test "$(cat /data/dsh/smoke 2>/dev/null)" = home \
    && test "$(jq -r .phase /data/platform/state/updater/transaction.json 2>/dev/null)" = rolled-back \
    && test "$(dsh-platform channel 2>/dev/null)" = experimental
' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    docker logs "$container" >&2
    echo "Experimental restart recovery did not complete" >&2
    exit 1
  fi
  sleep 0.2
done
docker exec "$container" sh -c '
  set -eu
  [ "$(cat /data/dsh/smoke)" = home ]
  [ "$(jq -r .phase /data/platform/state/updater/transaction.json)" = rolled-back ]
  [ "$(dsh-platform channel)" = experimental ]
'
cleanup
trap - EXIT INT TERM

platform_volume="dsh-platform-legacy-$$"
home_volume="dsh-home-legacy-$$"
trap cleanup EXIT INT TERM
docker run --rm --entrypoint sh \
  --volume "$platform_volume:/data/platform" \
  --volume "$home_volume:/data/dsh" \
  "$image" -c 'mkdir -p /data/platform/runtime && printf preserved > /data/dsh/sentinel'
set +e
legacy_output="$(timeout 15s docker run --rm \
  --volume "$platform_volume:/data/platform" \
  --volume "$home_volume:/data/dsh" \
  "$image" 2>&1)"
status=$?
set -e
[ "$status" -ne 0 ]
echo "$legacy_output" | grep -F 'clear only /data/platform' >/dev/null
echo "$legacy_output" | grep -F 'Do not delete /data/dsh' >/dev/null
docker run --rm --entrypoint sh --volume "$home_volume:/data/dsh" "$image" \
  -c '[ "$(cat /data/dsh/sentinel)" = preserved ]'
cleanup
trap - EXIT INT TERM

echo "Container smoke checks passed"
