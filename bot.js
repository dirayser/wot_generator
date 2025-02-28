require('dotenv').config();

const express = require('express');
const helmet = require('helmet');

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const tankDataMap = new Map(); // 📌 Кеш для данных о танках

const bot = new Telegraf(process.env.BOT_TOKEN);

// 📌 Ссылка для авторизации в Wargaming
const WG_AUTH_URL = `https://api.worldoftanks.eu/wot/auth/login/?application_id=${process.env.WG_APP_ID}&redirect_uri=${process.env.REDIRECT_URI}`;

const userDataMap = new Map(); // 📌 Хранилище пользователей (userId → { accessToken, accountId })

// 📌 Кнопка авторизации
bot.start((ctx) => {
    const startPayload = ctx.message.text.split(" ")[1]; // Получаем access_token после /start

    if (startPayload) {
        handleToken(ctx, startPayload);
    } else {
        ctx.reply(
            "Привет! Авторизуйся через Wargaming:",
            Markup.inlineKeyboard([
                Markup.button.url("🔑 Войти через Wargaming", WG_AUTH_URL + `${ctx.from.id}/`)
            ])
        );
    }
});

// 📌 Функция сохранения пользователя после авторизации
async function handleToken(userId, accessToken, accountId) {
    try {
        const url = `https://api.worldoftanks.eu/wot/account/info/`;
        const response = await axios.get(url, {
            params: {
                application_id: process.env.WG_APP_ID,
                access_token: accessToken,
                account_id: accountId
            }
        });

        console.log(response.data);
        const playerData = Object.values(response.data.data)[0];
        if (!playerData) {
            await bot.telegram.sendMessage(userId, "⚠ Ошибка: Не удалось получить данные игрока.");
            return;
        }

        // 🔹 Сохраняем accessToken и accountId в Map
        userDataMap.set(`${userId}`, { accessToken, accountId });

        await bot.telegram.sendMessage(
            userId,
            `✅ Авторизация успешна!\n👤 Игрок: ${playerData.nickname}\n\nТеперь ты можешь использовать команду /randomtank`
        );

    } catch (error) {
        console.error(error);
        await bot.telegram.sendMessage(userId, "⚠ Ошибка при получении данных.");
    }
}

// 📌 Обработчик /randomtank
bot.command("randomtank", async (ctx) => {
    const userId = ctx.from.id;
    const messageParts = ctx.message.text.split(" ");

    let level = null;
    let nation = null;

    if (messageParts.length > 1) {
        level = !isNaN(messageParts[1]) ? messageParts[1] : null;

        if (isNaN(messageParts[1])) {
            nation = messageParts[1]
        }
    }

    if (messageParts.length > 2) {
        nation = messageParts[2];
    }

    console.log({ level, nation });

    // 📌 Проверяем, есть ли у пользователя сохранённые данные
    if (!userDataMap.has(`${userId}`)) {
        await ctx.reply("⚠ Вам нужно сначала авторизоваться через Wargaming.\nИспользуйте команду /start.");
        return;
    }

    const { accessToken, accountId } = userDataMap.get(`${userId}`);
    await getRandomTank(ctx.chat.id, accessToken, accountId, level, nation);
});

// 📌 Функция генерации случайного танка
async function getRandomTank(chatId, accessToken, accountId, level = null, nation = null, userName = "Игрок") {
    try {
        // 📌 Получаем список танков в ангаре
        const tanksStatsUrl = `https://api.worldoftanks.eu/wot/tanks/stats/`;
        const statsResponse = await axios.get(tanksStatsUrl, {
            params: {
                application_id: process.env.WG_APP_ID,
                access_token: accessToken,
                account_id: accountId
            }
        });

        const tanks = statsResponse.data.data[accountId];

        if (!tanks || tanks.length === 0) {
            await bot.telegram.sendMessage(chatId, `⚠ ${userName}, у вас нет танков в ангаре.`);
            return;
        }

        // 📌 Соединяем данные из кеша (добавляем уровень и нацию к танкам в ангаре)
        let availableTanks = tanks
            .map(tank => ({
                ...tank,
                ...tankDataMap.get(tank.tank_id) // Берём данные из кеша энциклопедии
            }))
            .filter(tank => tank.name && tank.in_garage); // Оставляем только танки, которые в ангаре

        // 📌 Фильтруем по уровню (если задан)
        if (level) {
            availableTanks = availableTanks.filter(tank => tank.tier === parseInt(level));
        }

        // 📌 Фильтруем по нации (если задана)
        if (nation) {
            availableTanks = availableTanks.filter(tank => tank.nation === nation);
        }

        if (availableTanks.length === 0) {
            await bot.telegram.sendMessage(chatId, `⚠ ${userName}, у вас нет танков, соответствующих фильтру.`);
            return;
        }

        // 📌 Выбираем случайный танк
        const randomTank = availableTanks[Math.floor(Math.random() * availableTanks.length)];

        // 📌 Отправляем сообщение с изображением танка
        await bot.telegram.sendPhoto(
            chatId,
            randomTank.images.big_icon,
            {
                caption: `🎲 **${userName} получил танк:**\n🚀 **${randomTank.name}**\n⭐ Уровень: ${randomTank.tier}\n🏳️ Нация: ${randomTank.nation}`,
                parse_mode: "Markdown"
            }
        );

    } catch (error) {
        console.error("❌ Ошибка в getRandomTank:", error);
        await bot.telegram.sendMessage(chatId, `⚠ Ошибка при получении случайного танка для ${userName}.`);
    }
}

bot.command("randomtank_all", async (ctx) => {
    const chatId = ctx.chat.id;
    const messageParts = ctx.message.text.split(" ");
    let chosenTier = null;

    // 📌 Проверяем, указан ли уровень в команде
    if (messageParts.length > 1) {
        const parsedTier = parseInt(messageParts[1]);
        if (!isNaN(parsedTier) && parsedTier >= 6 && parsedTier <= 10) {
            chosenTier = parsedTier;
        } else {
            await ctx.reply("⚠ Укажите корректный уровень от 6 до 10, например: `/randomtank_all 8`", { parse_mode: "Markdown" });
            return;
        }
    }

    try {
        // 📌 Получаем список участников чата
        const members = await bot.telegram.getChatAdministrators(chatId);
        const userIdsInChat = members.map(member => member.user.id);

        // 📌 Оставляем только тех, кто есть в userDataMap (авторизованные пользователи)
        const authorizedUsers = userIdsInChat.filter(id => userDataMap.has(`${id}`));

        if (authorizedUsers.length === 0) {
            await ctx.reply("⚠ В этом чате нет авторизованных пользователей.");
            return;
        }

        // 📌 Если уровень не указан – выбираем случайный от 6 до 10
        const randomTier = chosenTier || Math.floor(Math.random() * 5) + 6;

        await ctx.reply(`🎲 Генерируем танки **уровня ${randomTier}** для всех участников...`);

        // 📌 Генерируем случайный танк каждому пользователю
        for (const userId of authorizedUsers) {
            const { accessToken, accountId } = userDataMap.get(`${userId}`);
            const userInfo = members.find(member => member.user.id == userId);
            const userName = userInfo ? `[${userInfo.user.first_name}](tg://user?id=${userId})` : `Игрок ${userId}`;

            await getRandomTank(chatId, accessToken, accountId, randomTier, null, userName);
        }

    } catch (error) {
        console.error("❌ Ошибка в randomtank_all:", error);
        await ctx.reply("⚠ Ошибка при получении списка пользователей.");
    }
});



// 📌 Запуск бота
bot.launch({
    polling: {
        interval: 1000,
    },
});

const app = express();
const port = process.env.PORT;

app.use(express.json());
app.use(helmet());

app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    next();
});

app.listen(port, () => {
    console.log(`Server started on port: ${port}`);
    loadTankData();
});


// 📌 Обработчик запроса от Wargaming с userId в пути
app.get('/:telegram_id', async (req, res) => {
    const { telegram_id } = req.params;
    const { access_token, account_id } = req.query;

    console.log({telegram_id, access_token, account_id });

    if (!access_token || !telegram_id || !account_id) {
        return res.status(400).send("⚠ Ошибка: Не удалось получить данные.");
    }

    // 📌 Сохраняем accessToken и accountId для пользователя
    await handleToken(telegram_id, access_token, account_id);

    // 📌 Редиректим в Telegram
    res.redirect(`https://t.me/${process.env.BOT_USERNAME}`);
});

// 📌 Функция загрузки танков при запуске бота
async function loadTankData() {
    try {
        console.log("🔄 Загружаем данные о танках...");
        const url = `https://api.worldoftanks.eu/wot/encyclopedia/vehicles/`;
        const response = await axios.get(url, {
            params: { application_id: process.env.WG_APP_ID }
        });

        if (response.data.status !== "ok") {
            console.error("❌ Ошибка загрузки данных о танках:", response.data.error);
            return;
        }

        // 📌 Сохраняем танки в `Map`
        for (const [tankId, tankInfo] of Object.entries(response.data.data)) {
            tankDataMap.set(parseInt(tankId), tankInfo);
        }

        console.log(`✅ Загружено ${tankDataMap.size} танков.`);
    } catch (error) {
        console.error("❌ Ошибка при загрузке данных о танках:", error);
    }
}