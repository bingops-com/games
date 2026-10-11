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
