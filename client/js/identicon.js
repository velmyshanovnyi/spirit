// Секція RF1 (specs/ui/redesign-foundation.md): детермінований identicon з
// fingerprint-хешу контакту. Чиста функція -- без DOM/app.js залежності, щоб
// лишатись тестованою у Node/jsdom без побічних ефектів. Алгоритм відтворює
// узгоджений з користувачем макет байт-в-байт: 5x3 сітка бітів, похідних від
// hex-символів хешу (з модульним індексуванням, щоб короткі входи не кидали
// винятку -- навмисно, а не хиба), дзеркальна по горизонталі (стовпець col і
// його зеркальний відповідник (4-col) малюються разом, коли вони різні).

/**
 * @param {string} hashHex - hex-рядок (fingerprint чи будь-який інший хеш).
 *   Довжина довільна: коротші за 25 символів входи безпечно "закільцовуються"
 *   через модульну індексацію (hashHex[i % hashHex.length]).
 * @returns {string} SVG-рядок, viewBox="0 0 100 100", fill="currentColor" --
 *   успадковує колір контейнера-аватара через CSS `color`.
 */
export function buildIdenticonSvg(hashHex) {
  const bits = [];
  for (let i = 0; i < 25; i++) {
    bits.push(parseInt(hashHex[i % hashHex.length], 16) % 2);
  }
  let cells = "";
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const idx = row * 3 + col;
      if (!bits[idx]) continue;
      const mirroredCol = 4 - col;
      cells += `<rect x="${col * 20}" y="${row * 20}" width="20" height="20"/>`;
      if (col !== mirroredCol) {
        cells += `<rect x="${mirroredCol * 20}" y="${row * 20}" width="20" height="20"/>`;
      }
    }
  }
  return `<svg viewBox="0 0 100 100" fill="currentColor">${cells}</svg>`;
}
