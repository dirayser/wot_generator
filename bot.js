require('dotenv').config();

const express = require('express');
const helmet = require('helmet');

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

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
        userDataMap.set(userId, { accessToken, accountId });

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
    }

    if (messageParts.length > 2) {
        nation = messageParts[2];
    }

    console.log(userDataMap);

    // 📌 Проверяем, есть ли у пользователя сохранённые данные
    if (!userDataMap.has(userId)) {
        await ctx.reply("⚠ Вам нужно сначала авторизоваться через Wargaming.\nИспользуйте команду /start.");
        return;
    }

    const { accessToken, accountId } = userDataMap.get(userId);
    await getRandomTank(userId, accessToken, accountId, level, nation);
});

// 📌 Функция генерации случайного танка
async function getRandomTank(userId, accessToken, accountId, level = null, nation = null) {
    try {
        const url = `https://api.worldoftanks.eu/wot/tanks/stats/`;
        const response = await axios.get(url, {
            params: {
                application_id: process.env.WG_APP_ID,
                access_token: accessToken,
                account_id: accountId
            }
        });

        const tanks = response.data.data[accountId];

        if (!tanks || tanks.length === 0) {
            await bot.telegram.sendMessage(userId, "⚠ У вас нет танков в ангаре.");
            return;
        }

        // 🔹 Фильтруем танки по уровню и/или нации
        let filteredTanks = tanks.filter(tank => tank.in_garage == true);

        if (level) {
            filteredTanks = filteredTanks.filter(tank => tank.tier === parseInt(level));
        }

        if (nation) {
            filteredTanks = filteredTanks.filter(tank => tank.nation === nation);
        }

        if (filteredTanks.length === 0) {
            await bot.telegram.sendMessage(userId, "⚠ У вас нет подходящих танков.");
            return;
        }

        // 🔹 Выбираем случайный танк
        const randomTank = filteredTanks[Math.floor(Math.random() * filteredTanks.length)];

        // 🔹 Получаем данные о танке (название + изображение)
        const tankInfoUrl = `https://api.worldoftanks.eu/wot/encyclopedia/tankinfo/`;
        const tankInfoResponse = await axios.get(tankInfoUrl, {
            params: {
                application_id: process.env.WG_APP_ID,
                tank_id: randomTank.tank_id
            }
        });

        const tankData = tankInfoResponse.data.data[randomTank.tank_id];

        if (!tankData) {
            await bot.telegram.sendMessage(userId, "⚠ Ошибка: Не удалось получить данные о танке.");
            return;
        }

        const tankName = tankData.name;
        const tankImage = tankData.images.big_icon; // Получаем URL изображения танка

        // 🔹 Отправляем сообщение с картинкой танка
        await bot.telegram.sendPhoto(
            userId,
            tankImage,
            {
                caption: `🎲 Вам выпал случайный танк:\n🚀 **${tankName}**\n⭐ Уровень: ${tankData.tier}\n🏳️ Нация: ${tankData.nation}`
            }
        );

    } catch (error) {
        console.error(error);
        await bot.telegram.sendMessage(userId, "⚠ Ошибка при получении случайного танка.");
    }
}



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