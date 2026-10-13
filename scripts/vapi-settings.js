// The check scripts/vapi-assistant.js makes on a settings file before it
// sends anything to Vapi: the file is one JSON object, and holds no key,
// token, secret or password (rule 12 in CLAUDE.md). Kept apart from the
// script so test/vapi-settings.test.ts can try it.

/** A field whose name looks like it holds a secret. */
export const SECRET_NAME = /secret|token|password|api_?key|authorization/i;

/** Why these settings must not be sent, or null if they can be. Never quotes a value. */
export function settingsProblem(settings) {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    return 'The settings file must hold one JSON object.';
  }
  const secretPath = findSecret(settings);
  return secretPath ? `The settings file has ${secretPath}. Keys and secrets stay out of the repository.` : null;
}

/** Where in the settings a field is named like a secret, if anywhere. */
function findSecret(value, path = '') {
  if (typeof value !== 'object' || value === null) return null;
  for (const [name, inner] of Object.entries(value)) {
    const here = `${path}${Array.isArray(value) ? `[${name}]` : `.${name}`}`;
    if (!Array.isArray(value) && SECRET_NAME.test(name)) return here;
    const deeper = findSecret(inner, here);
    if (deeper) return deeper;
  }
  return null;
}
