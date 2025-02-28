require('dotenv').config();

const express = require('express');
const helmet = require('helmet');

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

// 📌 Ссылка для авторизации в Wargaming
const WG_AUTH_URL = `https://api.worldoftanks.eu/wot/auth/login/?application_id=${process.env.WG_APP_ID}&redirect_uri=${process.env.REDIRECT_URI}`;

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

// 📌 Обработка access_token после авторизации
async function handleToken(ctx, accessToken) {
    try {
        const url = `https://api.worldoftanks.eu/wot/account/info/`;
        const response = await axios.get(url, {
            params: {
                application_id: process.env.WG_APP_ID,
                access_token: accessToken
            }
        });

        const playerData = Object.values(response.data.data)[0];
        if (!playerData) {
            await ctx.reply("⚠ Ошибка: Не удалось получить данные игрока.");
            return;
        }

        await ctx.reply(
            `✅ Авторизация успешна!\n👤 Игрок: ${playerData.nickname}\n🎮 Бои: ${playerData.statistics.battles}`
        );

    } catch (error) {
        console.error(error);
        await ctx.reply("⚠ Ошибка при получении данных.");
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

app.get('/:telegram_id', async (req, res) => {
    const { telegram_id } = req.params; // 📌 Получаем Telegram ID из path
    const { access_token, account_id, nickname, expires_at } = req.query; // 📌 Получаем параметры из запроса

    if (!access_token || !account_id || !nickname || !expires_at) {
        return res.status(400).send("⚠ Ошибка: Не удалось получить данные.");
    }

    try {
        // 📌 Отправляем сообщение пользователю в Telegram
        await bot.telegram.sendMessage(
            telegram_id,
            `✅ Авторизация успешна!\n👤 Игрок: ${nickname}\n🎮 ID: ${account_id}\n🔑 Токен: ${access_token}\n⏳ Действителен до: ${new Date(expires_at * 1000).toLocaleString()}`
        );

        // 📌 Редиректим в Telegram
        res.redirect(`https://t.me/${process.env.BOT_USERNAME}`);

    } catch (error) {
        console.error("Ошибка при отправке сообщения в Telegram:", error);
        res.status(500).send("⚠ Ошибка при обработке запроса.");
    }
});