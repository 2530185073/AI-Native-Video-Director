/**
 * Minimal JSON Schema (draft-07 subset) validator: enough to check LLM output
 * against the same schema we send to the model, without pulling in a dependency.
 *
 * Supported keywords: type (incl. arrays), enum, const, required, properties,
 * additionalProperties (boolean), items, minimum, maximum, minLength, maxLength,
 * minItems, maxItems, pattern, nullable.
 */

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  const list = Array.isArray(expected) ? expected : [expected];
  return list.some(type => type === actual || (type === 'number' && actual === 'integer'));
}

export function validateSchema(value, schema, path = '$', errors = []) {
  if (!schema || typeof schema !== 'object') return errors;

  if (value === null && schema.nullable) return errors;
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path}: expected ${Array.isArray(schema.type) ? schema.type.join('|') : schema.type}, got ${typeOf(value)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.some(option => option === value)) {
    errors.push(`${path}: value ${JSON.stringify(value)} not in enum [${schema.enum.map(option => JSON.stringify(option)).join(', ')}]`);
  }
  if (schema.const !== undefined && schema.const !== value) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  }

  const kind = typeOf(value);
  if (kind === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
  }
  if (kind === 'number' || kind === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${value} > maximum ${schema.maximum}`);
  }
  if (kind === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, `${path}[${index}]`, errors));
  }
  if (kind === 'object') {
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push(`${path}.${key}: required`);
    }
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) validateSchema(child, properties[key], `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unexpected property`);
    }
  }
  return errors;
}
