'use strict';

// Messenger API integration example
// We assume you have:
// * a Wit.ai bot setup (https://wit.ai/docs/quickstart)
// * a Messenger Platform setup (https://developers.facebook.com/docs/messenger-platform/quickstart)
// You need to `npm install` the following dependencies: body-parser, express, request.
//
// 1. npm install body-parser express request
// 2. Download and install ngrok from https://ngrok.com/download
// 3. ./ngrok http 8445
// 4. WIT_TOKEN=your_access_token FB_APP_SECRET=your_app_secret FB_PAGE_TOKEN=your_page_token node examples/messenger.js
// 5. Subscribe your page to the Webhooks using verify_token and `https://<your_ngrok_io>/webhook` as callback URL.
// 6. Talk to your bot on Messenger!

const bodyParser = require('body-parser');
const crypto = require('crypto');
const express = require('express');
const fetch = require('node-fetch');
const request = require('request');

const sleep = require('sleep');
const moment = require('moment-timezone');
const NodeFileParser = require('node-file-parser');

let Wit = null;
let log = null;
try {
  // if running from repo
  Wit = require('../').Wit;
  log = require('../').log;
} catch (e) {
  Wit = require('node-wit').Wit;
  log = require('node-wit').log;
}

// Webserver parameter
const PORT = process.env.PORT || 8445;

// Wit.ai parameters
const WIT_TOKEN = process.env.WIT_TOKEN;

// Messenger API parameters
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
if (!FB_PAGE_TOKEN) { throw new Error('missing FB_PAGE_TOKEN') }
const FB_APP_SECRET = process.env.FB_APP_SECRET;
if (!FB_APP_SECRET) { throw new Error('missing FB_APP_SECRET') }

const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
if (!FB_VERIFY_TOKEN) { throw new Error('missing FB_VERIFY_TOKEN') }
                                        
// ----------------------------------------------------------------------------
// Messenger API specific code

// See the Send API reference
// https://developers.facebook.com/docs/messenger-platform/send-api-reference

const fbMessage = (id, text) => {
  const body = JSON.stringify({
    recipient: { id },
    message: { text },
  });
  const qs = 'access_token=' + encodeURIComponent(FB_PAGE_TOKEN);
  return fetch('https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
  })
  .then(rsp => rsp.json())
  .then(json => {
    if (json.error && json.error.message) {
      throw new Error(json.error.message);
    }
    //console.log(json);
    return json;
  });
};

// Custom Code


// Send Msg 
const fbRichMessage = (id, json) => {
  console.log('Sending MSG to:' + id);
  var body = '{"recipient":{"id":"' + id + '"},' + json + '}';
  const qs = 'access_token=' + encodeURIComponent(FB_PAGE_TOKEN);
  return fetch('https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
  })
  .then(rsp => rsp.json())
  .then(responseJson => {
    if (json.error && json.error.message) {
      throw new Error(json.error.message);
    }
    //console.log(responseJson);
    return responseJson;
  });
};

// Handover to Live 
const fbHandOverMessage = (id, json, control) => {
  console.log('Handover to Live:' + id);
  var body = '{"recipient":{"id":"' + id + '"},' + json + '}';
  const qs = 'access_token=' + encodeURIComponent(FB_PAGE_TOKEN);
  return fetch('https://graph.facebook.com/v2.6/me/' + control + '_thread_control?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
  })
  .then(rsp => rsp.json())
  .then(responseJson => {
    if (json.error && json.error.message) {
      throw new Error(json.error.message);
    }
    //console.log(responseJson);
    return responseJson;
  });
};

// Msg Body Builder 
const GetText = (textLocation, textTitle) => {
    console.log('Fetching ' + textTitle + ' File Contents');
    var file = NodeFileParser.link(textLocation);
    var text = file.read().getContent();
    return text;
};

// Checks if the Stuido is open via the clock.
const CheckOpen = () => {
    //console.log(moment().tz("Asia/Singapore").format());  
    
    // Sets Day, Hour, Minute & open 
    var day = moment().tz("Asia/Singapore").weekday();  
    var hour = moment().tz("Asia/Singapore").hour();
    var minute = moment().tz("Asia/Singapore").minute();
    
    // Response Static half
    var open = 'Yes, we are currently open until';
    var closed = 'Unfortunately we are currently closed & will open tomorrow at';
    
    // Logic to Test if Open or Closed.
    //console.log(hour,day);
    if ((day >= 0 && day <= 5) && (hour >= 6 && hour <= 21)) {
        var opencloseTime = open + ' 9pm today'; 
    } else if ((day >= 6 && day <= 7) && ((hour >= 8 && hour <= 17) || (hour === 7 && minute >= 30))) {
        var opencloseTime = open + ' 5pm today'; 
    } else { if ((day + 1) >= 6 && (day + 1) <= 7) {var opencloseTime = closed + ' 7:30am';}
      else {var opencloseTime = closed + ' 6am';};
    }
    return opencloseTime; 
};

const OpenNextDay = () => {
    
};
      
// ----------------------------------------------------------------------------
// Wit.ai bot specific code

// This will contain all user sessions.
// Each session has an entry:
// sessionId -> {fbid: facebookUserId, context: sessionState}
const sessions = {};

const findOrCreateSession = (fbid) => {
  let sessionId;
  // Let's see if we already have a session for the user fbid
  Object.keys(sessions).forEach(k => {
    if (sessions[k].fbid === fbid) {
      // Yep, got it!
      sessionId = k;
    }
  });
  if (!sessionId) {
    // No session found for user fbid, let's create a new one
    sessionId = new Date().toISOString();
    sessions[sessionId] = {fbid: fbid, context: {}};
  }
  return sessionId;
};

// Our bot actions
const actions = {
  send({sessionId}, {text}) {
    // Our bot has something to say!
    // Let's retrieve the Facebook user whose session belongs to
    const recipientId = sessions[sessionId].fbid;
    if (recipientId) {
      // Yay, we found our recipient!
      // Let's forward our bot response to her.
      // We return a promise to let our bot know when we're done sending
      return fbMessage(recipientId, text)
      .then(() => null)
      .catch((err) => {
        console.error(
          'Oops! An error occurred while forwarding the response to',
          recipientId,
          ':',
          err.stack || err
        );
      });
    } else {
      console.error('Oops! Couldn\'t find user for session:', sessionId);
      // Giving the wheel back to our bot
      return Promise.resolve()
    }
  },
  // You should implement your custom actions here
  // See https://wit.ai/docs/quickstart
    
  // MY CUSTOM CODE
    
  // Welcome Text Messages. Have to put them in seperate Functions or they may not send in right order.
  WelcomeTextA(text) {
    var content = GetText('./Responses/Welcome/WelcomeTextA.txt', 'Welcome Text A');
    fbRichMessage(sessions[text.sessionId].fbid, content);  
  },

  WelcomeTextB(text) {
    var content = GetText('./Responses/Welcome/WelcomeTextB.txt', 'Welcome Text B'); 
    sleep.sleep(2);
    fbRichMessage(sessions[text.sessionId].fbid, content);  
  },

  WelcomeTextC(text) {
    var content = GetText('./Responses/Welcome/WelcomeTextC.txt', 'Welcome Text C'); 
    sleep.sleep(2);
    fbRichMessage(sessions[text.sessionId].fbid, content);  
  },

  // Contact Us / Directions
  Directions(text) {
    var content = GetText('./Responses/Directions/Directions.txt', 'Directions Card'); 
    fbRichMessage(sessions[text.sessionId].fbid, content);
  },
    
  // Operating Hours
  OperatingHours(text) {
    var content = GetText('./Responses/OpeningHours/OpenClose.txt', 'Operating Hours Card'); 
    var content = content + CheckOpen() + '" }';
    fbRichMessage(sessions[text.sessionId].fbid, content);
  },
    
  // Navigation Card
  Navigation(text) {
    var content = GetText('./Responses/Navigation/Navigation.txt', 'Navigation Card');
    fbRichMessage(sessions[text.sessionId].fbid, content);
  },
  
  // Class Type / Teacher Card
  ClassTypeTeacher(text) {
    var content = GetText('./Responses/ClassTypes/AllClassType.txt', 'ClassType / Teacher Card');
    fbRichMessage(sessions[text.sessionId].fbid, content);
  },
    
  // Help Cards
  HelpA(text) {
    var content = GetText('./Responses/Help/HelpTextA.txt', 'Help Text A');
    fbRichMessage(sessions[text.sessionId].fbid, content);
  },
    
  HelpB(text) {
    var content = GetText('./Responses/Help/HelpTextB.txt', 'Help Text B');
    sleep.sleep(3);
    fbRichMessage(sessions[text.sessionId].fbid, content);
  },

  HelpC(text) {
    var content = GetText('./Responses/Help/HelpTextC.txt', 'Help Text C');
    sleep.sleep(3);
    fbRichMessage(sessions[text.sessionId].fbid, content);
  },

  // Ok
  Ok(text) {
    var content = GetText('./Responses/Ok/Ok.txt', 'Ok Card');
    sleep.sleep(3);
    fbRichMessage(sessions[text.sessionId].fbid, content);
  },

  // Typing
  Typing(text) {
    var content = GetText('./Responses/Typing/Typing.txt', 'Typing Card'); 
    fbRichMessage(sessions[text.sessionId].fbid, content);
  },
  
  // Handover to Bot
   const CheckOpen = (text) =>  {
    sleep.sleep(15);
    var content = GetText('./Responses/Human/HandoverToBot.txt', 'Handover to Bot'); 
    fbHandOverMessage(sessions[text.sessionId].fbid, content, 'take'); 
  },

  // Handover to Live, After 12 hours will Return the Wheel.
  HandOverLive(text) {
    var content = GetText('./Responses/Human/HandoverText.txt', 'Handover Text'); 
    fbRichMessage(sessions[text.sessionId].fbid, content);
    var content = GetText('./Responses/Human/HandoverToLive.txt', 'Handover to Live'); 
    fbHandOverMessage(sessions[text.sessionId].fbid, content, 'pass');
    HandOverBot(text);
  },

  // Handover to Bot (Realised That You Can't ask for BOT while in the Bot)
//  HandOverLive(text) {
//    var content = GetText('./Responses/Human/HandoverToBot.txt', 'Handover to Bot'); 
//    fbHandOverMessage(sessions[text.sessionId].fbid, content);
//  },
    
    
};

// Setting up our bot
const wit = new Wit({
  accessToken: WIT_TOKEN,
  actions,
  logger: new log.Logger(log.INFO)
});

// Starting our webserver and putting it all together
const app = express();
app.use(({method, url}, rsp, next) => {
  rsp.on('finish', () => {
    console.log(`${rsp.statusCode} ${method} ${url}`);
  });
  next();
});
app.use(bodyParser.json({ verify: verifyRequestSignature }));

// Webhook setup
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === FB_VERIFY_TOKEN)   {
      res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(400);
  }
});



// Index route
app.get('/', function (req, res) {
	res.send('Hello world, I am a chat bot')
})

// Message handler
app.post('/webhook', (req, res) => {
  // Parse the Messenger payload
  // See the Webhook reference
  // https://developers.facebook.com/docs/messenger-platform/webhook-reference
  const data = req.body;

  if (data.object === 'page') {
    data.entry.forEach(entry => {
      entry.messaging.forEach(event => {
        if (event.message && !event.message.is_echo) {
          // Yay! We got a new message!
          // We retrieve the Facebook user ID of the sender
          const sender = event.sender.id;

          // We retrieve the user's current session, or create one if it doesn't exist
          // This is needed for our bot to figure out the conversation history
          const sessionId = findOrCreateSession(sender);

          // We retrieve the message content
          const {text, attachments} = event.message;

          if (attachments) {
            // We received an attachment
            // Let's reply with an automatic message
            fbMessage(sender, 'Sorry I can only process text messages for now.')
            .catch(console.error);
          } else if (text) {
            // We received a text message

            // Let's forward the message to the Wit.ai Bot Engine
            // This will run all actions until our bot has nothing left to do
            wit.runActions(
              sessionId, // the user's current session
              text, // the user's message
              sessions[sessionId].context // the user's current session state
            ).then((context) => {
              // Our bot did everything it has to do.
              // Now it's waiting for further messages to proceed.
              console.log('Waiting for next user messages');
              
              // Based on the session state, you might want to reset the session.
              // This depends heavily on the business logic of your bot.
              // Example:
              // if (context['done']) {
              //   delete sessions[sessionId];
              // }
                
              // Updating the user's current session state
              sessions[sessionId].context = context;
            })
            .catch((err) => {
              console.error('Oops! Got an error from Wit: ', err.stack || err);
            })
          }
        } else {
          console.log('received event', JSON.stringify(event));
        }
      });
    });
  }
  res.sendStatus(200);
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', FB_APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

app.listen(PORT);
console.log('Listening on :' + PORT + '...');