// One-shot anonymous nickname for ephemeral "spirit mode" chats
// (specs/ui/ephemeral-spirit-mode.md, Section F1) -- purely cosmetic,
// never persisted, never used for lookup/storage (Spirit ID stays the
// real identifier).
const ADJECTIVES = [
  "Тихий", "Спритний", "Загадковий", "Легкий", "Прозорий",
  "Дивний", "Швидкий", "Мовчазний", "Блідий", "Невловимий"
];

const CREATURES = [
  "Привид", "Дух", "Тінь", "Примара", "Марево",
  "Фантом", "Відлуння", "Силует", "Морок", "Вогник"
];

function pickRandom(list) {
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % list.length;
  return list[index];
}

export function generateAnonymousNickname() {
  return `${pickRandom(ADJECTIVES)} ${pickRandom(CREATURES)}`;
}
