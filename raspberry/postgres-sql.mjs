function replaceOutsideQuotedText(source, transform) {
  let result = "";
  let plain = "";
  let quote = null;

  const flush = () => {
    result += transform(plain);
    plain = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (!quote) {
      if (character === "'" || character === '"') {
        flush();
        quote = character;
        result += character;
      } else {
        plain += character;
      }
      continue;
    }

    result += character;
    if (character !== quote) continue;
    if (source[index + 1] === quote) {
      result += source[index + 1];
      index += 1;
    } else {
      quote = null;
    }
  }
  flush();
  return result;
}

function numberedParameters(sql) {
  let parameter = 0;
  return replaceOutsideQuotedText(sql, (plain) =>
    plain.replaceAll("?", () => `$${++parameter}`),
  );
}

function quotedCamelCaseAliases(sql) {
  return replaceOutsideQuotedText(sql, (plain) =>
    plain.replace(
      /\b([a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)\b/g,
      (_match, identifier) => `"${identifier}"`,
    ),
  );
}

export function postgresSql(sql) {
  let translated = sql.replaceAll("`", '"');
  const ignoreConflict = /^\s*INSERT\s+OR\s+IGNORE\s+/i.test(translated);
  translated = translated.replace(/^\s*INSERT\s+OR\s+IGNORE\s+/i, "INSERT ");
  translated = translated
    .replaceAll("MAX(0,remaining_wins-1)", "GREATEST(0,remaining_wins-1)")
    .replaceAll(
      "MIN(total_wins,remaining_wins+1)",
      "LEAST(total_wins,remaining_wins+1)",
    )
    .replaceAll(
      "GROUP_CONCAT(si.quantity || 'x ' || si.product_name, ' | ')",
      "STRING_AGG(si.quantity::text || 'x ' || si.product_name, ' | ' ORDER BY si.id)",
    )
    .replaceAll(
      "GROUP_CONCAT(si.quantity || '× ' || si.product_name, ', ')",
      "STRING_AGG(si.quantity::text || '× ' || si.product_name, ', ' ORDER BY si.id)",
    );
  if (ignoreConflict && !/\bON\s+CONFLICT\b/i.test(translated)) {
    translated = `${translated.trim().replace(/;$/, "")} ON CONFLICT DO NOTHING`;
  }
  return numberedParameters(quotedCamelCaseAliases(translated));
}
