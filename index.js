const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder
} = require("discord.js");

require("dotenv").config();
const fs = require("fs");

const DB_FILE = "./actividad.json";
const DIAS_INACTIVO = Number(process.env.DIAS_INACTIVO || 14);
const DIAS_AVISO = Number(process.env.DIAS_AVISO || 3);

let db = fs.existsSync(DB_FILE)
  ? JSON.parse(fs.readFileSync(DB_FILE, "utf8"))
  : {};

function guardar() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function asegurarServidor(guildId) {
  if (!db[guildId]) {
    db[guildId] = {
      actividad: {},
      avisados: {},
      logChannelId: null
    };
  }

  if (!db[guildId].actividad) db[guildId].actividad = {};
  if (!db[guildId].avisados) db[guildId].avisados = {};
}

function tiempoTexto(ms) {
  const dias = Math.floor(ms / (1000 * 60 * 60 * 24));
  const horas = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const minutos = Math.floor((ms / (1000 * 60)) % 60);

  if (dias > 0) return `${dias} días, ${horas} horas`;
  if (horas > 0) return `${horas} horas, ${minutos} minutos`;
  return `${minutos} minutos`;
}

async function enviarLog(guild, mensaje) {
  asegurarServidor(guild.id);

  const canalId = db[guild.id].logChannelId;
  if (!canalId) return;

  const canal = await guild.channels.fetch(canalId).catch(() => null);
  if (!canal) return;

  await canal.send(mensaje).catch(() => {});
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const commands = [
  new SlashCommandBuilder()
    .setName("setlogs")
    .setDescription("Configura el canal donde el bot mandará logs.")
    .addChannelOption(option =>
      option
        .setName("canal")
        .setDescription("Canal de logs")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("inactivos")
    .setDescription("Muestra miembros que ya están cerca o pasan el límite de inactividad."),

  new SlashCommandBuilder()
    .setName("actividad")
    .setDescription("Muestra cuánto tiempo lleva cada miembro sin escribir.")
].map(command => command.toJSON());

client.once("clientReady", async () => {
  console.log(`Bot conectado como ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );

    console.log("Comandos slash registrados correctamente.");
  } catch (error) {
    console.log("Error registrando comandos:", error);
  }

  setInterval(revisarInactivos, 1000 * 60 * 30);
});

client.on("messageCreate", (message) => {
  if (message.author.bot || !message.guild) return;

  asegurarServidor(message.guild.id);

  db[message.guild.id].actividad[message.author.id] = Date.now();

  if (db[message.guild.id].avisados[message.author.id]) {
    delete db[message.guild.id].avisados[message.author.id];
  }

  guardar();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  asegurarServidor(interaction.guild.id);

  if (interaction.commandName === "setlogs") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: "No tienes permiso para usar este comando.",
        ephemeral: true
      });
    }

    const canal = interaction.options.getChannel("canal");
    db[interaction.guild.id].logChannelId = canal.id;
    guardar();

    return interaction.reply({
      content: `Canal de logs configurado en ${canal}.`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "inactivos") {
    await interaction.deferReply({ ephemeral: true });

    const miembros = await interaction.guild.members.fetch();
    const ahora = Date.now();
    const limiteAviso = (DIAS_INACTIVO - DIAS_AVISO) * 24 * 60 * 60 * 1000;

    let lista = [];

    miembros.forEach(member => {
      if (member.user.bot) return;

      const ultima = db[interaction.guild.id].actividad[member.id] || member.joinedTimestamp;
      if (!ultima) return;

      const inactivoMs = ahora - ultima;

      if (inactivoMs >= limiteAviso) {
        lista.push({
          nombre: member.user.tag,
          tiempo: tiempoTexto(inactivoMs)
        });
      }
    });

    lista.sort((a, b) => {
      const diasA = Number(a.tiempo.split(" ")[0]) || 0;
      const diasB = Number(b.tiempo.split(" ")[0]) || 0;
      return diasB - diasA;
    });

    if (lista.length === 0) {
      return interaction.editReply("No hay miembros cerca del límite de inactividad.");
    }

    const texto = lista
      .slice(0, 30)
      .map((u, i) => `${i + 1}. **${u.nombre}** — ${u.tiempo} sin escribir`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("Miembros inactivos o cerca del límite")
      .setDescription(texto)
      .setFooter({ text: `Límite: ${DIAS_INACTIVO} días | Aviso: ${DIAS_AVISO} días antes` });

    return interaction.editReply({ embeds: [embed] });
  }

  if (interaction.commandName === "actividad") {
    await interaction.deferReply({ ephemeral: true });

    const miembros = await interaction.guild.members.fetch();
    const ahora = Date.now();

    let lista = [];

    miembros.forEach(member => {
      if (member.user.bot) return;

      const ultima = db[interaction.guild.id].actividad[member.id] || member.joinedTimestamp;
      if (!ultima) return;

      const inactivoMs = ahora - ultima;

      lista.push({
        nombre: member.user.tag,
        inactivoMs,
        texto: tiempoTexto(inactivoMs)
      });
    });

    lista.sort((a, b) => b.inactivoMs - a.inactivoMs);

    const texto = lista
      .slice(0, 30)
      .map((u, i) => `${i + 1}. **${u.nombre}** — ${u.texto} sin escribir`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("Actividad de miembros")
      .setDescription(texto || "No hay datos todavía.")
      .setFooter({ text: "Solo muestra los primeros 30 miembros más inactivos." });

    return interaction.editReply({ embeds: [embed] });
  }
});

async function revisarInactivos() {
  const ahora = Date.now();
  const limiteKick = ahora - DIAS_INACTIVO * 24 * 60 * 60 * 1000;
  const limiteAviso = ahora - (DIAS_INACTIVO - DIAS_AVISO) * 24 * 60 * 60 * 1000;

  for (const guild of client.guilds.cache.values()) {
    asegurarServidor(guild.id);

    const me = await guild.members.fetchMe().catch(() => null);
    if (!me) continue;

    if (!me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      console.log(`No tengo permiso para expulsar en ${guild.name}`);
      continue;
    }

    const miembros = await guild.members.fetch().catch(() => null);
    if (!miembros) continue;

    for (const member of miembros.values()) {
      if (member.user.bot) continue;
      if (member.permissions.has(PermissionsBitField.Flags.Administrator)) continue;
      if (!member.kickable) continue;

      const ultimaActividad = db[guild.id].actividad[member.id];
      const fechaBase = ultimaActividad || member.joinedTimestamp;

      if (!fechaBase) continue;

      if (fechaBase <= limiteKick) {
        try {
          await member.kick(`Inactividad de más de ${DIAS_INACTIVO} días`);

          delete db[guild.id].actividad[member.id];
          delete db[guild.id].avisados[member.id];
          guardar();

          await enviarLog(
            guild,
            `Expulsé a **${member.user.tag}** por inactividad de más de **${DIAS_INACTIVO} días**.`
          );

          console.log(`Expulsado: ${member.user.tag}`);
        } catch (err) {
          console.log(`No pude expulsar a ${member.user.tag}: ${err.message}`);
        }

        continue;
      }

      if (fechaBase <= limiteAviso && !db[guild.id].avisados[member.id]) {
        db[guild.id].avisados[member.id] = Date.now();
        guardar();

        const diasRestantes = DIAS_INACTIVO - Math.floor((ahora - fechaBase) / (1000 * 60 * 60 * 24));

        await member.send(
          `Hola, este es un aviso del servidor **${guild.name}**. Estás cerca de ser expulsado por inactividad. Tienes aproximadamente **${diasRestantes} días** para escribir en el servidor y renovar tu actividad.`
        ).catch(() => {});

        await enviarLog(
          guild,
          `Avisé a **${member.user.tag}** que está cerca de ser expulsado por inactividad.`
        );

        console.log(`Avisado por inactividad: ${member.user.tag}`);
      }
    }
  }
}

client.login(process.env.TOKEN);
