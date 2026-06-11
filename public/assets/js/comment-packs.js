// Packs de comentários automáticos para a live
// Exporta: PACKS, buildComments

export const PACKS = [
  {
    id: "elogios",
    name: "Elogios à live",
    icon: "🔥",
    comments: [
      "Que aula incrível!",
      "Estou adorando essa aula! 🙌",
      "Melhor conteúdo que já vi sobre isso",
      "Isso aqui é ouro puro",
      "Anotando tudo aqui!",
      "Que revelação, nunca tinha pensado assim",
      "Nunca vi isso explicado de forma tão clara",
      "Nossa, que nível de conteúdo alto",
      "Valeu cada minuto aqui",
      "Tô impressionado(a) com a qualidade",
      "Isso mudou minha visão completamente",
      "Parabéns, conteúdo demais!",
      "Que incrível essa parte agora",
      "Sem palavras 🙏",
      "Voltei aqui só pra ouvir isso de novo",
      "Que domínio do assunto!",
      "Isso me ajudou demais",
      "Conteúdo raro de encontrar de graça",
      "Tô recomendando pra todo mundo",
      "Melhor decisão ter entrado nessa live",
      "Isso deveria ser pago kk",
      "Minha mente explodiu 🤯",
    ],
  },
  {
    id: "cta",
    name: "Call to Action",
    icon: "💳",
    comments: [
      "Eu quero! Onde clico?",
      "Já acessei! 🙌",
      "Garanti minha vaga!",
      "Comprei agora há pouco 🎉",
      "Cliquei no botão já!",
      "Tô dentro!",
      "Comprado! Ansioso(a) pra começar",
      "Me inscrevi sim! ✅",
      "Garantida a minha vaga 🙏",
      "Não pensei duas vezes",
      "Já tô no grupo!",
      "Fiz a compra, que emoção!",
      "Não deixei passar dessa vez",
      "Aproveitei a oferta!",
      "Tomei a decisão agora mesmo",
      "Era exatamente isso que eu esperava",
      "Fiz minha inscrição 🔥",
      "Paguei e não me arrependi",
      "Entrei! Quero muito aprender",
      "Oferta boa demais pra deixar passar",
      "Compra feita, agora é só estudar",
      "Não tive dúvida, comprei!",
    ],
  },
  {
    id: "duvidas",
    name: "Dúvidas",
    icon: "❓",
    comments: [
      "Funciona para quem está começando do zero?",
      "Tem suporte depois da compra?",
      "Por quanto tempo tenho acesso?",
      "Dá pra parcelar?",
      "Tem comunidade?",
      "É ao vivo ou posso assistir gravado?",
      "Quando começa?",
      "Como acesso o material depois?",
      "Tem garantia de satisfação?",
      "Posso acessar pelo celular?",
      "Tem mentoria individual?",
      "Quantas aulas são ao todo?",
      "Tem certificado?",
      "Como é a entrega do produto?",
      "Posso fazer no meu próprio ritmo?",
      "Funciona pra quem já tem experiência?",
      "Tem desconto pra grupos?",
      "Qual plataforma usa para as aulas?",
      "Tem bônus?",
      "Quando abre novamente?",
    ],
  },
  {
    id: "descobertas",
    name: "Descobertas",
    icon: "🤯",
    comments: [
      "Nunca tinha pensado nisso antes!",
      "Isso me abriu a mente 🤯",
      "Que insight enorme!",
      "Isso explica tudo que eu estava errando",
      "Tomando nota de tudo agora mesmo",
      "Precisava tanto ouvir isso",
      "Por que ninguém falou isso antes?!",
      "Esse é o ponto chave que faltava",
      "Achei que sabia, mas não sabia nada",
      "Isso muda tudo na minha estratégia",
      "Vou precisar rever esse trecho depois",
      "Tantos anos fazendo errado...",
      "Que clareza isso trouxe!",
      "Esse conteúdo é transformador",
      "Passei anos procurando isso",
      "Simples e genial ao mesmo tempo",
      "Tô processando tudo aqui",
      "Cada palavra é ouro",
      "Meu negócio vai mudar depois disso",
      "Salvando esse conteúdo agora",
    ],
  },
  {
    id: "engajamento",
    name: "Engajamento",
    icon: "💬",
    comments: [
      "Boa noite a todos! 👋",
      "Assistindo pelo celular, kkk",
      "Que energia boa essa live!",
      "Compartilhei com minha sócia",
      "Indiquei pro meu marido assistir também",
      "To aqui desde o início 💪",
      "Voltei! Perdi um pedacinho",
      "Assistindo pela segunda vez, vale muito",
      "Esse conteúdo é diferenciado mesmo",
      "Mandei o link pro grupo da família",
      "Vim pelo Instagram, que conteúdo!",
      "Assistindo com meu filho aqui",
      "Café na mão e foco total ☕",
      "Que alegria estar aqui hoje",
      "Finalmente achei o que eu precisava",
      "Chegando agora, não perdi muito né?",
      "Compartilhando no story agora",
      "Obrigada por esse conteúdo gratuito!",
      "Que tarde produtiva essa!",
      "Demorei pra chegar mas cheguei!",
    ],
  },
];

const NAMES_MALE = [
  "Rafael","Lucas","Matheus","Pedro","Gabriel","Felipe","Rodrigo","Anderson",
  "Bruno","Eduardo","Thiago","Carlos","Diego","Leonardo","Marcelo","Daniel",
  "Fernando","Paulo","Gustavo","André","Vinicius","Alan","Igor","Leandro",
  "Renato","Ricardo","Alex","Caio","Fábio","Sandro",
];

const NAMES_FEMALE = [
  "Ana","Maria","Juliana","Fernanda","Camila","Larissa","Patrícia","Gabriela",
  "Amanda","Letícia","Carolina","Isabela","Mariana","Beatriz","Vanessa","Renata",
  "Priscila","Bárbara","Daniela","Natalia","Claudia","Simone","Bruna","Aline",
  "Carla","Verônica","Luciana","Débora","Tânia","Mônica",
];

const SURNAMES = [
  "Silva","Santos","Oliveira","Souza","Rodrigues","Ferreira","Alves","Pereira",
  "Lima","Gomes","Costa","Ribeiro","Martins","Carvalho","Almeida","Lopes",
  "Soares","Fernandes","Vieira","Barbosa","Rocha","Dias","Monteiro","Cardoso",
  "Castro","Correia","Melo","Cunha","Moura","Pinto","Machado","Cavalcanti",
  "Duarte","Freitas","Mendes","Andrade","Ramos","Nascimento","Rezende","Fonseca",
  "Medeiros","Marques","Nunes","Teixeira","Campos","Moreira","Neto","Pires",
  "Santana","Xavier",
];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateName(gender, usedNames) {
  const pool = gender === "female" ? NAMES_FEMALE
              : gender === "male"   ? NAMES_MALE
              : Math.random() < 0.5 ? NAMES_FEMALE : NAMES_MALE;

  const firstName = rand(pool);
  // If this first name was already used, pick a different surname
  const usedSurnames = usedNames
    .filter(n => n.startsWith(firstName + " "))
    .map(n => n.split(" ")[1]);
  const freeSurnames = SURNAMES.filter(s => !usedSurnames.includes(s));
  const surname = freeSurnames.length > 0 ? rand(freeSurnames) : rand(SURNAMES);
  const full = firstName + " " + surname;
  usedNames.push(full);
  return full;
}

export function buildComments({ packs, count, startSec, endSec, gender }) {
  if (!packs.length || count < 1) return [];

  // Merge and shuffle comment bodies from selected packs
  const bodies = shuffle(packs.flatMap(p => p.comments));
  const totalBodies = bodies.length;

  const range = Math.max(1, endSec - startSec);
  const interval = range / count;
  const usedNames = [];
  const result = [];

  for (let i = 0; i < count; i++) {
    const body = bodies[i % totalBodies];
    const base = startSec + i * interval;
    const jitter = (Math.random() * 40) - 20; // ±20s
    const t = Math.round(Math.max(startSec, Math.min(endSec, base + jitter)));
    result.push({
      author_name: generateName(gender, usedNames),
      body,
      show_at_seconds: t,
      type: "comment",
    });
  }

  return result.sort((a, b) => a.show_at_seconds - b.show_at_seconds);
}
