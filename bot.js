require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const axios = require("axios");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════

const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
const UNIVERSE_ID = process.env.ROBLOX_UNIVERSE_ID;
const MOD_ROLE_ID = process.env.MOD_ROLE_ID || null;

const OPEN_CLOUD_BASE = "https://apis.roblox.com";

// 10 years in seconds — used as "permanent" since Open Cloud doesn't support -1
const PERMANENT_DURATION_SECONDS = 315360000;

// ═══════════════════════════════════════════
// ROBLOX OPEN CLOUD HELPERS
// ═══════════════════════════════════════════

// publish a message to MessagingService (for kicks, announcements, shutdown)
async function publishMessage(topic, data) {
  const url = `${OPEN_CLOUD_BASE}/messaging-service/v1/universes/${UNIVERSE_ID}/topics/${topic}`;

  await axios.post(
    url,
    { message: JSON.stringify(data) },
    {
      headers: {
        "x-api-key": ROBLOX_API_KEY,
        "Content-Type": "application/json",
      },
    }
  );
}

// ban a player using Open Cloud User Restrictions API (native Roblox ban system)
// this is the same system as Players:BanAsync() — handles alt detection, persistence, etc.
async function banPlayerOpenCloud(userId, reason, durationSeconds, moderator) {
  const url = `${OPEN_CLOUD_BASE}/cloud/v2/universes/${UNIVERSE_ID}/user-restrictions/${userId}`;

  const isPermanent = durationSeconds <= 0;
  const actualDuration = isPermanent ? PERMANENT_DURATION_SECONDS : durationSeconds;

  const body = {
    gameJoinRestriction: {
      active: true,
      duration: `${actualDuration}s`,
      privateReason: `[${new Date().toISOString()}] ${reason} | Mod: ${moderator}`,
      displayReason: `Banned: ${reason}`,
      excludeAltAccounts: false,
    },
  };

  const response = await axios.patch(url, body, {
    headers: {
      "x-api-key": ROBLOX_API_KEY,
      "Content-Type": "application/json",
    },
  });

  return response.data;
}

// unban a player using Open Cloud User Restrictions API
async function unbanPlayerOpenCloud(userId) {
  const url = `${OPEN_CLOUD_BASE}/cloud/v2/universes/${UNIVERSE_ID}/user-restrictions/${userId}`;

  const body = {
    gameJoinRestriction: {
      active: false,
    },
  };

  const response = await axios.patch(url, body, {
    headers: {
      "x-api-key": ROBLOX_API_KEY,
      "Content-Type": "application/json",
    },
  });

  return response.data;
}

// get a player's ban status using Open Cloud User Restrictions API
async function getBanStatus(userId) {
  const url = `${OPEN_CLOUD_BASE}/cloud/v2/universes/${UNIVERSE_ID}/user-restrictions/${userId}`;

  try {
    const response = await axios.get(url, {
      headers: {
        "x-api-key": ROBLOX_API_KEY,
      },
    });

    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return null;
    }
    throw error;
  }
}

// look up Roblox user info
async function getRobloxUser(userId) {
  try {
    const response = await axios.get(
      `https://users.roblox.com/v1/users/${userId}`
    );
    return response.data;
  } catch {
    return null;
  }
}

// get Roblox user avatar thumbnail
async function getRobloxAvatar(userId) {
  try {
    const response = await axios.get(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`
    );
    if (response.data.data && response.data.data.length > 0) {
      return response.data.data[0].imageUrl;
    }
  } catch {
    // ignore
  }
  return null;
}

// ═══════════════════════════════════════════
// PERMISSION CHECK
// ═══════════════════════════════════════════

function hasModPermission(interaction) {
  if (!MOD_ROLE_ID) return true;
  if (interaction.member.roles.cache.has(MOD_ROLE_ID)) return true;
  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator))
    return true;
  return false;
}

// ═══════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════

async function handleBan(interaction) {
  if (!hasModPermission(interaction)) {
    return interaction.reply({
      content: "❌ You don't have permission to use this command.",
      ephemeral: true,
    });
  }

  const userId = interaction.options.getInteger("userid");
  const reason = interaction.options.getString("reason") || "No reason provided";
  const durationMinutes = interaction.options.getInteger("duration") || 0;
  const durationSeconds = durationMinutes * 60;

  await interaction.deferReply();

  try {
    const robloxUser = await getRobloxUser(userId);
    const username = robloxUser ? robloxUser.name : "Unknown";
    const avatar = await getRobloxAvatar(userId);

    // 1. ban via Open Cloud User Restrictions API (native Roblox ban system)
    await banPlayerOpenCloud(userId, reason, durationSeconds, interaction.user.tag);

    // 2. also notify game servers via MessagingService to kick + call BanAsync as backup
    try {
      await publishMessage("SentinelAC_Commands", {
        command: "ban",
        userId: userId,
        reason: reason,
        duration: durationMinutes === 0 ? -1 : durationSeconds,
        moderator: interaction.user.tag,
      });
    } catch {
      // servers might not be running, that's fine — Open Cloud ban is already applied
    }

    const durationText =
      durationMinutes === 0
        ? "Permanent"
        : `${durationMinutes} minute${durationMinutes !== 1 ? "s" : ""}`;

    const embed = new EmbedBuilder()
      .setTitle("🔨 Player Banned")
      .setColor(0x8b0000)
      .setThumbnail(avatar)
      .addFields(
        { name: "Player", value: `${username} (\`${userId}\`)`, inline: true },
        { name: "Duration", value: durationText, inline: true },
        { name: "Reason", value: reason, inline: false },
        { name: "Moderator", value: interaction.user.tag, inline: true },
        { name: "Alt Ban", value: "✅ Enabled", inline: true }
      )
      .setFooter({ text: "Roblox Native Ban API • SentinelAC v2.1" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Ban error:", error.response?.data || error.message);
    await interaction.editReply({
      content: `❌ Failed to ban player: ${error.response?.data?.message || error.message}`,
    });
  }
}

async function handleUnban(interaction) {
  if (!hasModPermission(interaction)) {
    return interaction.reply({
      content: "❌ You don't have permission to use this command.",
      ephemeral: true,
    });
  }

  const userId = interaction.options.getInteger("userid");

  await interaction.deferReply();

  try {
    const robloxUser = await getRobloxUser(userId);
    const username = robloxUser ? robloxUser.name : "Unknown";

    // 1. unban via Open Cloud
    await unbanPlayerOpenCloud(userId);

    // 2. notify servers as backup
    try {
      await publishMessage("SentinelAC_Commands", {
        command: "unban",
        userId: userId,
        moderator: interaction.user.tag,
      });
    } catch {
      // fine if no servers running
    }

    const embed = new EmbedBuilder()
      .setTitle("✅ Player Unbanned")
      .setColor(0x00ff00)
      .addFields(
        { name: "Player", value: `${username} (\`${userId}\`)`, inline: true },
        { name: "Moderator", value: interaction.user.tag, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Unban error:", error.response?.data || error.message);
    await interaction.editReply({
      content: `❌ Failed to unban player: ${error.response?.data?.message || error.message}`,
    });
  }
}

async function handleKick(interaction) {
  if (!hasModPermission(interaction)) {
    return interaction.reply({
      content: "❌ You don't have permission to use this command.",
      ephemeral: true,
    });
  }

  const userId = interaction.options.getInteger("userid");
  const reason = interaction.options.getString("reason") || "Kicked by moderator";

  await interaction.deferReply();

  try {
    const robloxUser = await getRobloxUser(userId);
    const username = robloxUser ? robloxUser.name : "Unknown";

    await publishMessage("SentinelAC_Commands", {
      command: "kick",
      userId: userId,
      reason: reason,
      moderator: interaction.user.tag,
    });

    const embed = new EmbedBuilder()
      .setTitle("👢 Player Kicked")
      .setColor(0xffa500)
      .addFields(
        { name: "Player", value: `${username} (\`${userId}\`)`, inline: true },
        { name: "Reason", value: reason, inline: false },
        { name: "Moderator", value: interaction.user.tag, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Kick error:", error.message);
    await interaction.editReply({
      content: `❌ Failed to kick player: ${error.message}`,
    });
  }
}

async function handleAnnounce(interaction) {
  if (!hasModPermission(interaction)) {
    return interaction.reply({
      content: "❌ You don't have permission to use this command.",
      ephemeral: true,
    });
  }

  const message = interaction.options.getString("message");

  await interaction.deferReply();

  try {
    await publishMessage("SentinelAC_Announce", {
      message: message,
      moderator: interaction.user.tag,
    });

    const embed = new EmbedBuilder()
      .setTitle("📢 Announcement Sent")
      .setColor(0x3498db)
      .setDescription(message)
      .addFields({
        name: "Sent By",
        value: interaction.user.tag,
        inline: true,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Announce error:", error.message);
    await interaction.editReply({
      content: `❌ Failed to send announcement: ${error.message}`,
    });
  }
}

async function handleWhitelist(interaction) {
  if (!hasModPermission(interaction)) {
    return interaction.reply({
      content: "❌ You don't have permission to use this command.",
      ephemeral: true,
    });
  }

  const userId = interaction.options.getInteger("userid");

  await interaction.deferReply();

  try {
    const robloxUser = await getRobloxUser(userId);
    const username = robloxUser ? robloxUser.name : "Unknown";

    await publishMessage("SentinelAC_Commands", {
      command: "whitelist",
      userId: userId,
      moderator: interaction.user.tag,
    });

    const embed = new EmbedBuilder()
      .setTitle("🛡️ Player Whitelisted")
      .setColor(0x00ff88)
      .addFields(
        { name: "Player", value: `${username} (\`${userId}\`)`, inline: true },
        { name: "Moderator", value: interaction.user.tag, inline: true }
      )
      .setFooter({
        text: "Anticheat checks skipped for this player (current session only)",
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Whitelist error:", error.message);
    await interaction.editReply({
      content: `❌ Failed to whitelist player: ${error.message}`,
    });
  }
}

async function handleUnwhitelist(interaction) {
  if (!hasModPermission(interaction)) {
    return interaction.reply({
      content: "❌ You don't have permission to use this command.",
      ephemeral: true,
    });
  }

  const userId = interaction.options.getInteger("userid");

  await interaction.deferReply();

  try {
    const robloxUser = await getRobloxUser(userId);
    const username = robloxUser ? robloxUser.name : "Unknown";

    await publishMessage("SentinelAC_Commands", {
      command: "unwhitelist",
      userId: userId,
      moderator: interaction.user.tag,
    });

    const embed = new EmbedBuilder()
      .setTitle("🔓 Whitelist Removed")
      .setColor(0xff6600)
      .addFields(
        { name: "Player", value: `${username} (\`${userId}\`)`, inline: true },
        { name: "Moderator", value: interaction.user.tag, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Unwhitelist error:", error.message);
    await interaction.editReply({
      content: `❌ Failed to remove whitelist: ${error.message}`,
    });
  }
}

async function handleCheckBan(interaction) {
  const userId = interaction.options.getInteger("userid");

  await interaction.deferReply();

  try {
    const robloxUser = await getRobloxUser(userId);
    const username = robloxUser ? robloxUser.name : "Unknown";
    const avatar = await getRobloxAvatar(userId);

    const banStatus = await getBanStatus(userId);

    const restriction = banStatus?.gameJoinRestriction;
    const isActive = restriction?.active === true;

    if (!isActive) {
      const embed = new EmbedBuilder()
        .setTitle("✅ Not Banned")
        .setColor(0x00ff00)
        .setThumbnail(avatar)
        .setDescription(`**${username}** (\`${userId}\`) is not banned.`)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // parse duration
    let durationText = "Unknown";
    if (restriction.duration) {
      const seconds = parseInt(restriction.duration.replace("s", ""));
      if (seconds >= PERMANENT_DURATION_SECONDS) {
        durationText = "Permanent";
      } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        durationText = `${hours}h ${minutes}m total`;
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("🔨 Player is Banned")
      .setColor(0xff0000)
      .setThumbnail(avatar)
      .addFields(
        { name: "Player", value: `${username} (\`${userId}\`)`, inline: true },
        { name: "Duration", value: durationText, inline: true },
        {
          name: "Display Reason",
          value: restriction.displayReason || "No reason",
          inline: false,
        },
        {
          name: "Private Reason",
          value: restriction.privateReason || "N/A",
          inline: false,
        }
      )
      .setFooter({ text: "Roblox Native Ban API • SentinelAC v2.1" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Check ban error:", error.response?.data || error.message);
    await interaction.editReply({
      content: `❌ Failed to check ban status: ${error.response?.data?.message || error.message}`,
    });
  }
}

async function handleShutdown(interaction) {
  if (!hasModPermission(interaction)) {
    return interaction.reply({
      content: "❌ You don't have permission to use this command.",
      ephemeral: true,
    });
  }

  const reason =
    interaction.options.getString("reason") || "Server shutdown by moderator";

  await interaction.deferReply();

  try {
    await publishMessage("SentinelAC_Commands", {
      command: "shutdown",
      reason: reason,
      moderator: interaction.user.tag,
    });

    const embed = new EmbedBuilder()
      .setTitle("⚠️ Server Shutdown Initiated")
      .setColor(0xff0000)
      .addFields(
        { name: "Reason", value: reason, inline: false },
        { name: "Initiated By", value: interaction.user.tag, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Shutdown error:", error.message);
    await interaction.editReply({
      content: `❌ Failed to initiate shutdown: ${error.message}`,
    });
  }
}

async function handleLookup(interaction) {
  const userId = interaction.options.getInteger("userid");

  await interaction.deferReply();

  try {
    const robloxUser = await getRobloxUser(userId);

    if (!robloxUser) {
      return interaction.editReply({
        content: `❌ Could not find Roblox user with ID \`${userId}\`.`,
      });
    }

    const avatar = await getRobloxAvatar(userId);

    // check ban status
    let isBanned = false;
    let banReason = null;
    try {
      const banStatus = await getBanStatus(userId);
      if (banStatus?.gameJoinRestriction?.active === true) {
        isBanned = true;
        banReason = banStatus.gameJoinRestriction.displayReason;
      }
    } catch {
      // couldn't check, just skip
    }

    const created = new Date(robloxUser.created).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const embed = new EmbedBuilder()
      .setTitle(`🔍 ${robloxUser.name}`)
      .setColor(isBanned ? 0xff0000 : 0x3498db)
      .setThumbnail(avatar)
      .setURL(`https://www.roblox.com/users/${userId}/profile`)
      .addFields(
        {
          name: "Display Name",
          value: robloxUser.displayName || robloxUser.name,
          inline: true,
        },
        { name: "User ID", value: `\`${userId}\``, inline: true },
        { name: "Account Created", value: created, inline: true },
        {
          name: "Ban Status",
          value: isBanned ? "🔨 Banned" : "✅ Clean",
          inline: true,
        }
      )
      .setTimestamp();

    if (robloxUser.description) {
      embed.addFields({
        name: "Bio",
        value:
          robloxUser.description.length > 200
            ? robloxUser.description.substring(0, 200) + "..."
            : robloxUser.description || "No bio",
        inline: false,
      });
    }

    if (isBanned && banReason) {
      embed.addFields({
        name: "Ban Reason",
        value: banReason,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Lookup error:", error.message);
    await interaction.editReply({
      content: `❌ Failed to look up user: ${error.message}`,
    });
  }
}

// ═══════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════

client.once("ready", () => {
  console.log(`✅ SentinelAC Bot logged in as ${client.user.tag}`);
  console.log(`📡 Universe ID: ${UNIVERSE_ID}`);
  console.log(`🔑 Mod Role: ${MOD_ROLE_ID || "None (all users)"}`);

  client.user.setActivity("Monitoring for exploits", { type: 3 });
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const handlers = {
    ban: handleBan,
    unban: handleUnban,
    kick: handleKick,
    announce: handleAnnounce,
    whitelist: handleWhitelist,
    unwhitelist: handleUnwhitelist,
    checkban: handleCheckBan,
    shutdown: handleShutdown,
    lookup: handleLookup,
  };

  const handler = handlers[interaction.commandName];
  if (handler) {
    try {
      await handler(interaction);
    } catch (error) {
      console.error(`Command error [${interaction.commandName}]:`, error);
      const reply = {
        content: "❌ An unexpected error occurred.",
        ephemeral: true,
      };
      if (interaction.deferred) {
        await interaction.editReply(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  }
});

// ═══════════════════════════════════════════
// START BOT
// ═══════════════════════════════════════════

client.login(process.env.DISCORD_TOKEN);
