const REDACTED = "[REDACTED]";
const BEARER_CREDENTIAL = /\bBearer\s+[^\s,;]+/giu;

export function redactSecrets(
  value: string,
  secrets: readonly string[] = [],
): string {
  const uniqueSecrets = [...new Set(secrets)]
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length);

  const redacted = uniqueSecrets.reduce(
    (result, secret) => result.split(secret).join(REDACTED),
    value,
  );

  return redacted.replace(BEARER_CREDENTIAL, `Bearer ${REDACTED}`);
}
