const {
  Client,
  GatewayIntentBits,
  PermissionsBitField
} = require("discord.js");

require("dotenv").config();
const fs = require("fs");

const DB_FILE = "./actividad.json";
const DIAS = Number(process.env.DIAS_INACTIVO || 14);

let actividad = fs.existsSync(DB_FILE)
  ? JSON.parse(fs.readFileSync(DB_FILE, "utf8"))
  : {};

function guardar() {
  fs.writeFileSync(DB_FILE, JSON.stringify(actividad, null, 2));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

client.once("ready", () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  setInterval(revisarInactivos, 1000 * 60 * 60);
});

client.on("messageCreate", (message) => {
  if (message.author.bot || !message.guild) return;

  const guildId = message.guild.id;
  const userId = message.author.id;

  if (!actividad[guildId]) actividad[guildId] = {};

  actividad[guildId][userId] = Date.now();
  guardar();
});

async function revisarInactivos() {
  const limite = Date.now() - DIAS * 24 * 60 * 60 * 1000;

  for (const guild of client.guilds.cache.values()) {
    const me = await guild.members.fetchMe();

    if (!me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      console.log(`No tengo permiso para expulsar en ${guild.name}`);
      continue;
    }

    await guild.members.fetch();

    for (const member of guild.members.cache.values()) {
      if (member.user.bot) continue;
      if (member.permissions.has(PermissionsBitField.Flags.Administrator)) continue;
      if (!member.kickable) continue;

      const ultimaActividad = actividad[guild.id]?.[member.id];
      const fechaBase = ultimaActividad || member.joinedTimestamp;

      if (fechaBase && fechaBase < limite) {
        try {
          await member.kick(`Inactividad de más de ${DIAS} días`);
          console.log(`Expulsado: ${member.user.tag}`);
        } catch (err) {
          console.log(`No pude expulsar a ${member.user.tag}: ${err.message}`);
        }
      }
    }
  }
}

client.login(process.env.TOKEN);