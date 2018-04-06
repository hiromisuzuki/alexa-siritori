"use strict";

const Alexa = require("alexa-sdk");
const _ = require("lodash");
const kuromoji = require("kuromoji");
const alexaVocab = require("alexaVocab.json")

const APP_ID = undefined;

const GAME_NAME = "しりとりスキル";
const START_MESSAGE = "しりとりスキルへようこそ。" +
    "ゲームを始めるには、まず、「しりとり」と言ってみてください。";
const UNHANDLED = "ちょっと何言ってるかわからない。";
const HELP_MESSAGE = "しりとりを続けますか？" +
    "続ける場合は「はい」、やめる場合は「いいえ」、と言ってください。";
const CANCEL_MESSAGE = "しりとりを終了します。";
const SURRENDER_MESSAGE = "返せる言葉がありません。あなたの勝ちです。";

const KUROMOJI_DICT_PATH = "node_modules/kuromoji/dict/";

// ステートによるスキルの状態管理
const GAME_STATES = {
    START: "_STARTMODE",
    SIRITORI: "_SIRITORIMODE",
    HELP: "_HELPMODE",
};

// スキル起動時のステートハンドラ
const newSessionHandlers = {
    "LaunchRequest": function () {
        // ゲームスタート時のステートをセット
        this.handler.state = GAME_STATES.START;
        this.emitWithState("NewGame");
    },
    "AMAZON.StartOverIntent": function () {
        this.handler.state = GAME_STATES.START;
        this.emitWithState("NewGame");
    },
    "AMAZON.HelpIntent": function () {
        this.handler.state = GAME_STATES.HELP;
        this.emitWithState("helpTheUser");
    },
    "Unhandled": function () {
        const speechOutput = UNHANDLED;
        this.emit(":ask", speechOutput);
    }
};

// しりとりスタート時のステートハンドラ
const startStateHandlers = Alexa.CreateStateHandler(GAME_STATES.START, {
    "NewGame": function () {
        // ゲーム中のステートをセット
        this.handler.state = GAME_STATES.SIRITORI;
        const speechOutput = START_MESSAGE;
        this.emit(":ask", speechOutput);
    },
    "Unhandled": function () {
        const speechOutput = UNHANDLED;
        this.emit(":ask", speechOutput);
    },
});

// しりとりゲーム中のステートハンドラ
const siritoriStateHandlers = Alexa.CreateStateHandler(GAME_STATES.SIRITORI, {
    "SiritoriIntent": function () {

        // 既出単語の配列をセッションアトリビュートから参照する
        let previousWords = this.attributes["previousWords"];

        // 初回の処理(入力は「しりとり」)
        if (previousWords == null) {
            // 「リ」から始まる単語を辞書から取得する
            const answer = alexaVocab.words["リ"][0]
            // 既出単語の配列に代入する
            this.attributes["previousWords"] = [answer];
            this.emit(":elicitSlot", "SiritoriWord", answer);
        }

        // GAME_STATES.HELPステートから復帰時の処理
        if (this.attributes["break"]) {
            this.attributes["break"] = false;
            const speechOutput = "しりとりを再開します。前の単語は、" +
                previousWords[previousWords.length - 1] + "です。" +
                "次の単語を入力してください。";
            this.emit(":elicitSlot", "SiritoriWord", speechOutput);
        }

        // SiritoriWordのスロット値を取得する
        const inputWord = this.event.request.intent.slots.SiritoriWord.value;

        // スロット値が空の場合
        if (inputWord == null) {
            const speechOutput = "単語が取得できませんでした。" +
                "違う単語を試してみてください。";
            this.emit(":elicitSlot", "SiritoriWord", speechOutput);
        }

        // 同期処理を設定し、形態素変換が終わってから以後のしりとり処理が行われるようにする
        new Promise((resolve, reject) => {
            // kuromojiによる形態素変換
            kuromoji.builder({ dicPath: KUROMOJI_DICT_PATH }).build(
                function (err, tokenizer) {
                    if (err) {
                        throw err;
                    }
                    resolve(tokenizer.tokenize(String(inputWord)));
                }
            )
        }).then((tok) => {
            // 形態素変換を繰り返すとメモリリークが起こるため、
            // 強制的にガベージコレクションを開始する
            gc();

            // 入力単語が名詞一単語ではない場合
            if (tok.length > 1 || tok[0].pos != "名詞") {
                this.emit(":elicitSlot", "SiritoriWord",
                    inputWord + "、は使えない言葉です。名詞一単語で答えてください。");
            }

            // 読み仮名が取得できない単語の場合
            if (!tok[0].hasOwnProperty("reading")) {
                const speechOutput = "単語の読みがなが取得できません。" +
                    "違う単語を試してみてください。";
                this.emit(":elicitSlot", "SiritoriWord", speechOutput);
            }

            // 読み仮名(カタカナ)の取得
            const inputWordReading = tok[0].reading;
            // 入力単語・前回単語の頭の文字・末尾の文字を取得する
            const inputHeadChar = inputWordReading.slice(0, 1);
            // 単語末尾の伸ばし棒は削除する
            const inputLastChar = inputWordReading
                .replace(new RegExp("ー$"), "").slice(-1);
            const previousLastChar = previousWords[previousWords.length - 1]
                .replace(new RegExp("ー$"), "").slice(-1);

            // 入力単語の先頭文字が間違っている場合
            if (previousLastChar != inputHeadChar) {
                const speechOutput = inputWordReading + "は先頭の文字が" +
                    previousLastChar + "ではありません。" +
                    previousLastChar + "から始まる単語を入力してください";
                this.emit(":elicitSlot", "SiritoriWord", speechOutput);
            }

            // 入力単語が既出である場合
            if (previousWords.indexOf(inputWordReading) != -1) {
                const speechOutput = inputWordReading +
                    "は既に使われた単語です。他の単語を入力してください";
                this.emit(":elicitSlot", "SiritoriWord", speechOutput);
            }

            // 入力単語が「ん」で終わる場合。アレクサの勝利とし、スキルを終了する
            if (inputLastChar == "ン") {
                const speechOutput = inputWordReading +
                    "は、「ん」で終わる単語ですね。" +
                    "しりとりは私の勝ちです。またの挑戦を待っています。";
                this.emit(":tell", speechOutput);
            }
            // 次に返せる単語を辞書から探す
            const answers = _.difference(
                alexaVocab.words[inputLastChar],
                previousWords
            );
            // 返せる単語がある場合
            if (answers.length > 0) {
                const answer = answers[0];
                // ユーザーの入力単語・アレクサの返答単語の順で、
                // 既出単語の配列に追加していく
                previousWords.push(inputWordReading);
                previousWords.push(answer);
                // セッションアトリビュートに代入し、既出単語の配列を更新する
                this.attributes["previousWords"] = previousWords;
                this.emit(":elicitSlot", "SiritoriWord", answer);
            }
            // 返せる単語がない場合。ユーザーの勝利とし、スキルを終了する
            this.emit(":tell", SURRENDER_MESSAGE);
        })
    },
    "AMAZON.HelpIntent": function () {
        this.handler.state = GAME_STATES.HELP;
        this.emitWithState("helpTheUser", false);
    },
    "AMAZON.StopIntent": function () {
        this.handler.state = GAME_STATES.HELP;
        this.emitWithState("helpTheUser", false);
    },
    "AMAZON.CancelIntent": function () {
        const speechOutput = CANCEL_MESSAGE;
        this.emit(":tell", speechOutput);
    },
    "Unhandled": function () {
        const speechOutput = UNHANDLED;
        this.emit(":ask", speechOutput);
    }
});

// ヘルプが呼び出された際のステートハンドラ
const helpStateHandlers = Alexa.CreateStateHandler(GAME_STATES.HELP, {
    "helpTheUser": function () {
        const speechOutput = HELP_MESSAGE;
        this.emit(":ask", speechOutput);
    },
    "AMAZON.StartOverIntent": function () {
        this.handler.state = GAME_STATES.START;
        this.emitWithState("NewGame");
    },
    "AMAZON.HelpIntent": function () {
        this.emitWithState("helpTheUser");
    },
    // しりとりを続ける場合
    "AMAZON.YesIntent": function () {
        // 復帰時の処理のため
        this.attributes["break"] = true;
        this.handler.state = GAME_STATES.SIRITORI;
        this.emitWithState("SiritoriIntent");
    },
    "AMAZON.NoIntent": function () {
        const speechOutput = CANCEL_MESSAGE;
        this.emit(":tell", speechOutput);
    },
    "AMAZON.StopIntent": function () {
        const speechOutput = HELP_MESSAGE;
        this.emit(":tell", speechOutput);
    },
    "AMAZON.CancelIntent": function () {
        const speechOutput = CANCEL_MESSAGE;
        this.emit(":tell", speechOutput);
    },
    "Unhandled": function () {
        const speechOutput = UNHANDLED;
        this.emit(":ask", speechOutput);
    },
});

exports.handler = function (event, context) {
    const alexa = Alexa.handler(event, context);
    alexa.APP_ID = APP_ID;
    alexa.registerHandlers(
        newSessionHandlers, 
        startStateHandlers,
        siritoriStateHandlers, 
        helpStateHandlers);
    alexa.execute();
};