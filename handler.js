"use strict";

const line = require("@line/bot-sdk");
const crypto = require("crypto");
const client = new line.Client({
  channelAccessToken: process.env.ACCESSTOKEN,
  channelSecret: process.env.CHANNELSECRET,
});

const options = process.env.LOCAL
  ? { region: "localhost", endpoint: "http://localhost:8082" } // ymlファイルの63行目と統一する
  : {};

const AWS = require("aws-sdk");
const dynamo = new AWS.DynamoDB.DocumentClient(options);
const TableName = process.env.TableName;

module.exports.logProtein = async (event, context) => {
  const body = JSON.parse(event.body);

  const signature = crypto
    .createHmac("sha256", process.env.CHANNELSECRET)
    .update(event.body)
    .digest("base64");
  const checkHeader = (event.headers || {})["X-Line-Signature"];

  if (checkHeader === signature) {
    if (body.events[0].replyToken === "00000000000000000000000000000000") {
      // LINEのwebhookの「検証」をおすとここが動作する
      let lambdaResponse = {
        statusCode: 200,
        headers: { "X-Line-Status": "OK" },
        body: '{"result":"connect check"}',
      };
      context.succeed(lambdaResponse);
    } else {
      try {
        const userId = body.events[0].source.userId;
        const sentAt = body.events[0].timestamp;
        const protein = Number(body.events[0].message.text);
        const yesterday = sentAt - 24 * 3600 * 1000;
        const queryParams = {
          TableName,
          ExpressionAttributeValues: { ":y": yesterday, ":u": userId },
          KeyConditionExpression: "userId = :u and sentAt > :y",
        };

        const putParams = {
          TableName,
          Item: {
            userId,
            sentAt,
            protein,
          },
        };
        const putResult = await dynamo.put(putParams).promise();
        const result = await dynamo.query(queryParams).promise();
        const totalProtein = result.Items.map((item) => item.protein).reduce(
          (a, b) => a + b
        );

        const message1 = {
          type: "text",
          text: `この24時間で${totalProtein}gのタンパク質を摂取したぞ`,
        };
        const message2 =
          totalProtein < 100
            ? {
                type: "text",
                text: `引き続き、高タンパク/低脂質低糖質の食事を心掛けろ`,
              }
            : {
                type: "text",
                text: `タンパク質の摂りすぎも禁物だ。過剰摂取は腸内環境を悪化させる危険があるぞ`,
              };

        return client
          .replyMessage(body.events[0].replyToken, [message1, message2])
          .then((response) => {
            let lambdaResponse = {
              statusCode: 200,
              headers: { "X-Line-Status": "OK" },
              body: '{"result":"completed"}',
            };
            context.succeed(lambdaResponse);
          })
          .catch((err) => console.log(err));
      } catch (error) {
        return {
          statusCode: error.statusCode,
          body: error.message,
        };
      }
    }
  } else {
    console.log("署名認証エラー");
  }
};
