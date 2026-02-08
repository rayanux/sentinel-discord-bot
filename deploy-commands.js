require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a player from the Roblox game")
    .addIntegerOption((opt) =>
      opt
        .setName("userid")
        .setDescription("Roblox User ID to ban")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("reason")
        .setDescription("Reason for the ban")
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("duration")
        .setDescription("Ban duration in minutes (0 = permanent)")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a player from the Roblox game")
    .addIntegerOption((opt) =>
      opt
        .setName("userid")
        .setDescription("Roblox User ID to unban")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a player from all game servers")
    .addIntegerOption((opt) =>
      opt
        .setName("userid")
        .setDescription("Roblox User ID to kick")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("reason")
        .setDescription("Reason for the kick")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send an announcement to all game servers")
    .addStringOption((opt) =>
      opt
        .setName("message")
        .setDescription("Announcement message")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Whitelist a player (skip anticheat checks)")
    .addIntegerOption((opt) =>
      opt
        .setName("userid")
        .setDescription("Roblox User ID to whitelist")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unwhitelist")
    .setDescription("Remove a player from the whitelist")
    .addIntegerOption((opt) =>
      opt
        .setName("userid")
        .setDescription("Roblox User ID to unwhitelist")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("checkban")
    .setDescription("Check if a player is currently banned")
    .addIntegerOption((opt) =>
      opt
        .setName("userid")
        .setDescription("Roblox User ID to check")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("shutdown")
    .setDescription("Shutdown all game servers")
    .addStringOption((opt) =>
      opt
        .setName("reason")
        .setDescription("Reason for shutdown")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("lookup")
    .setDescription("Look up a Roblox user by their ID")
    .addIntegerOption((opt) =>
      opt
        .setName("userid")
        .setDescription("Roblox User ID")
        .setRequired(true)
    ),
].map((cmd) => cmd.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");

    if (process.env.GUILD_ID) {
      // guild-specific (instant, good for testing)
      await rest.put(
        Routes.applicationGuildCommands(
          process.env.CLIENT_ID,
          process.env.GUILD_ID
        ),
        { body: commands }
      );
      console.log(`Registered ${commands.length} commands to guild ${process.env.GUILD_ID}`);
    } else {
      // global (takes up to 1 hour to propagate)
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
        body: commands,
      });
      console.log(`Registered ${commands.length} global commands`);
    }
  } catch (error) {
    console.error("Failed to register commands:", error);
  }
})();
