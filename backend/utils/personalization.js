// Derives {{first_name}}/{{last_name}}/{{email}} for a recipient straight
// from their email address — there's no separate "contact" record with real
// names behind the seedlist, so the local-part (before @) is all we have.
// "john.doe@x.com" -> John / Doe. "johndoe@x.com" -> Johndoe / "" (no
// separator to split a last name out of).
const NAME_SEPARATOR_REGEX = /[._+-]+/;

const capitalize = (word) =>
  word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;

const derivePersonalizationVariables = (email) => {
  const localPart = (email || '').split('@')[0] || '';
  const parts = localPart.split(NAME_SEPARATOR_REGEX).filter(Boolean);

  return {
    first_name: capitalize(parts[0] || ''),
    last_name: parts.length > 1 ? capitalize(parts[parts.length - 1]) : '',
    email: email || '',
  };
};

module.exports = { derivePersonalizationVariables };
