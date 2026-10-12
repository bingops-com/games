{{- define "games.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "games.fullname" -}}
{{- if .Values.fullnameOverride -}}
  {{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
  {{- $name := include "games.name" . -}}
  {{- if contains $name .Release.Name -}}
    {{- .Release.Name | trunc 63 | trimSuffix "-" -}}
  {{- else -}}
    {{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
  {{- end -}}
{{- end -}}
{{- end }}

{{- define "games.selectorLabels" -}}
app.kubernetes.io/name: {{ include "games.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "games.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{ include "games.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Name of the CloudNativePG cluster owned by the release. */}}
{{- define "games.postgresql" -}}
{{- printf "%s-postgresql" (include "games.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/* The secret and key holding the connection string. */}}
{{- define "games.databaseSecret" -}}
{{- if .Values.database.cnpg.enabled -}}
{{- printf "%s-app" (include "games.postgresql" .) -}}
{{- else -}}
{{- required "database.existingSecret.name is required when database.cnpg.enabled is false" .Values.database.existingSecret.name -}}
{{- end -}}
{{- end }}

{{- define "games.databaseSecretKey" -}}
{{- if .Values.database.cnpg.enabled -}}uri{{- else -}}{{ .Values.database.existingSecret.key }}{{- end -}}
{{- end }}

{{- define "games.production" -}}
{{- if or .Values.production .Values.ingress.enabled -}}true{{- else -}}false{{- end -}}
{{- end }}

{{- define "games.image" -}}
{{- if .Values.image.digest -}}
{{ .Values.image.repository }}@{{ .Values.image.digest }}
{{- else -}}
{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}
{{- end -}}
{{- end }}

{{- define "games.validate" -}}
{{- if .Values.database.cnpg.recovery.enabled -}}
{{- if or (not .Values.database.cnpg.enabled) (not .Values.database.cnpg.backup.enabled) -}}{{- fail "recovery requires CNPG and its backup ObjectStore configuration" -}}{{- end -}}
{{- if empty .Values.database.cnpg.recovery.serverName -}}{{- fail "recovery.serverName must name the source archive generation" -}}{{- end -}}
{{- if eq .Values.database.cnpg.recovery.serverName .Values.database.cnpg.backup.serverName -}}{{- fail "restored cluster must archive under a different serverName than its recovery source" -}}{{- end -}}
{{- end -}}
{{- if ne (int .Values.replicaCount) 1 -}}
{{- fail "replicaCount must be 1: live rooms are not shared between processes" -}}
{{- end -}}
{{- if eq (include "games.production" .) "true" -}}
{{- if not (regexMatch "^https://[^/?#@]+/?$" .Values.publicUrl) -}}
{{- fail "production requires publicUrl to be a canonical HTTPS origin" -}}
{{- end -}}
{{- if empty .Values.mail.relay -}}{{- fail "production requires mail.relay (SMTP with trusted STARTTLS)" -}}{{- end -}}
{{- if and .Values.ingress.enabled (not .Values.ingress.tls.enabled) -}}{{- fail "production ingress requires TLS" -}}{{- end -}}
{{- if and .Values.ingress.enabled (ne (trimSuffix "/" .Values.publicUrl) (printf "https://%s" .Values.ingress.host)) -}}{{- fail "publicUrl must match the HTTPS ingress host" -}}{{- end -}}
{{- if ne .Values.service.type "ClusterIP" -}}{{- fail "production service must be ClusterIP behind the declared proxy" -}}{{- end -}}
{{- if not .Values.networkPolicy.enabled -}}{{- fail "production requires networkPolicy.enabled" -}}{{- end -}}
{{- if empty .Values.networkPolicy.ingressFrom -}}{{- fail "production requires explicit trusted proxy peers" -}}{{- end -}}
{{- range .Values.networkPolicy.ingressFrom -}}
{{- if or (empty (dig "namespaceSelector" "matchLabels" (dict) .)) (empty (dig "podSelector" "matchLabels" (dict) .)) -}}{{- fail "trusted proxy peers require both namespace and pod labels" -}}{{- end -}}
{{- end -}}
{{- if .Values.image.digest -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .Values.image.digest) -}}{{- fail "image.digest must be a sha256 digest" -}}{{- end -}}
{{- else if not (regexMatch "^sha-[a-f0-9]{40}$" .Values.image.tag) -}}
{{- fail "production requires image.digest or an immutable sha-<40-hex-commit> image.tag" -}}
{{- end -}}
{{- if .Values.database.cnpg.enabled -}}
{{- if not .Values.database.cnpg.backup.enabled -}}{{- fail "production requires continuous database backups" -}}{{- end -}}
{{- else -}}
{{- if empty .Values.database.existingSecret.backupRunbook -}}{{- fail "production external database requires its owning backupRunbook" -}}{{- end -}}
{{- if empty .Values.networkPolicy.databaseTo -}}{{- fail "external database requires explicit networkPolicy.databaseTo peers" -}}{{- end -}}
{{- end -}}
{{- if or (empty .Values.networkPolicy.dnsTo) (empty .Values.networkPolicy.smtpTo) -}}{{- fail "production requires explicit DNS and SMTP egress peers" -}}{{- end -}}
{{- end -}}
{{- end }}
