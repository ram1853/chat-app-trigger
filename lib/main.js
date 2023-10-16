const audioUtils        = require('./audioUtils');  // for encoding audio data as PCM
const crypto            = require('crypto'); // tot sign our pre-signed URL
const v4                = require('./aws-signature-v4'); // to generate our pre-signed URL
const marshaller        = require("@aws-sdk/eventstream-marshaller"); // for converting binary event stream messages to and from JSON
const util_utf8_node    = require("@aws-sdk/util-utf8-node"); // utilities for encoding and decoding UTF8
const mic               = require('microphone-stream'); // collect microphone input as a stream of raw bytes

// our converter between binary event streams messages and JSON
const eventStreamMarshaller = new marshaller.EventStreamMarshaller(util_utf8_node.toUtf8, util_utf8_node.fromUtf8);

// our global variables for managing state
let languageCode;
let region;
let sampleRate;
let inputSampleRate;
let transcription = "";
let socket;
let micStream;
let socketError = false;
let transcribeException = false;
let speechData="";

// check to see if the browser allows mic access
if (!window.navigator.mediaDevices.getUserMedia) {
    // Use our helper method to show an error on the page
    showError('We support the latest versions of Chrome, Firefox, Safari, and Edge. Update your browser and try your request again.');

    // maintain enabled/distabled state for the start and stop buttons
    toggleStartStop();
}

$('#start-button').click(function () {
    $('#error').hide(); // hide any existing errors
    toggleStartStop(true); // disable start and enable stop button
    $('#responsePlay').attr("disabled", true);

    // set the language and region from the dropdowns
    setLanguage();
    setRegion();

    // first we get the microphone input from the browser (as a promise)...
    window.navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true
        })
        // ...then we convert the mic stream to binary event stream messages when the promise resolves 
        .then(streamAudioToWebSocket) 
        .catch(function (error) {
            showError('There was an error streaming your audio to Amazon Transcribe. Please try again.');
            toggleStartStop();
        });
});

let streamAudioToWebSocket = function (userMediaStream) {
    //let's get the mic input from the browser, via the microphone-stream module
    micStream = new mic();

    micStream.on("format", function(data) {
        inputSampleRate = data.sampleRate;
    });

    micStream.setStream(userMediaStream);

    // Pre-signed URLs are a way to authenticate a request (or WebSocket connection, in this case)
    // via Query Parameters. Learn more: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    let url = createPresignedUrl();

    //open up our WebSocket connection
    socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";

    let sampleRate = 0;

    // when we get audio data from the mic, send it to the WebSocket if possible
    socket.onopen = function() {
        micStream.on('data', function(rawAudioChunk) {
            // the audio stream is raw audio bytes. Transcribe expects PCM with additional metadata, encoded as binary
            let binary = convertAudioToBinaryMessage(rawAudioChunk);

            if (socket.readyState === socket.OPEN)
                socket.send(binary);
        }
    )};

    // handle messages, errors, and close events
    wireSocketEvents();

    const playButton = document.getElementById('responsePlay');
    playButton.addEventListener("click", function() {
        console.log("speechData: "+speechData);
        fetch("https://hsm6rofk6m5mfxibd2qtorzl3y0dgsxs.lambda-url.ap-south-1.on.aws/", {
                method: "POST",
                body: JSON.stringify({
                    data: speechData
                }),
                headers: {
                    "Content-type": "application/json; charset=UTF-8"
                }
                })
                .then((response) => response.json())
                .then((json) => {
                    console.log('response from lambda: '+ json);
                    console.log('stringified: '+JSON.stringify(json['url']));
                    let player = new Audio('https://ai-chat-bucket-demo.s3.amazonaws.com/test.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIA35RP5HA243VLL5HY%2F20231016%2Fap-south-1%2Fs3%2Faws4_request&X-Amz-Date=20231016T154001Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEGAaCmFwLXNvdXRoLTEiSDBGAiEAxKMiA%2FfAFveDrEXUsoe9dzrfRroUi98mxDLncjymysgCIQC1Oo9yyhkJkAZ9SYSWw53vBJWZyVcAFp6spr0Hal9nVirlAgh5EAAaDDgxOTM2NTQ5Mjc4OSIM2BIcsCeJszhXhurBKsIC%2FDyuX9CBAahz2JFn4MS1OubmCeOQXA9Rw%2FxAreQkWMjkauMSG9RbZ2riLwb6CbOKwssJocKSMiGzz2cRbgW6nOIfRDPBPLM9Y3Wgu6aKAZVsTubSF0t5CgE301I52V3FIr9yOkBS0xbe6%2FjwzTeI3EpO2fAOUiBKRU8F%2B%2BGoSLdIFN6ktbLz7X66pBUcvSYmggciZR5WjODFGWyNQfJo%2BYr1Xw%2FL0fLSj0yyr90TOygjBWaehQhia2%2BzLhYgxtYvl6D4yPgV%2FZ2U3LVzFgc5Zqo7V2PwvtO6PH3uz0Fc40zuJmc5kEbeFTXOrBLYeCpB7LPQsN8rbQP5CyVtcmzZKeCeOjn32XqbCg14WGI5J7YTHSfuAXL8xqr5iCQFOrRO7Uj9XwgBdvWOs6CVhrAnp5IT5VjyAJw4DkMUneJgpdCBjjDOsrWpBjqdAaBUooUAozivx6Me%2BAVOg8S8PoB%2FoNZ9mXkkhHGA39x%2BIy4%2FIjHhRRk6qOqHAkz1P6zHouyqZRqP05w8ORWst0cTDff1gIEuNAm2pP7kUtxWuhW2o64Omls4H10yElEhUMFeiKtwe5GEBqzRAcUOiqM3Ea7swtipk60fUgAKJi6UFXONGi3%2F%2FxSu%2B%2Fxv7VkIJQ3U5%2B%2BJmjDgr2y3q8A%3D&X-Amz-Signature=4a0661ae6c9edd65859506727e96e377d5110f25b76918aa4758959250a02008');
                    player.crossOrigin = "anonymous";
                    player.play();
                    speechData="";
    });
        
        
        //player.addEventListener("canplaythrough", function() {
               
        //})
        
    })


    
}

function setLanguage() {
    languageCode = $('#language').find(':selected').val();
    if (languageCode == "en-US" || languageCode == "es-US")
        sampleRate = 44100;
    else
        sampleRate = 8000;
}

function setRegion() {
    region = $('#region').find(':selected').val();
}

function wireSocketEvents() {
    // handle inbound messages from Amazon Transcribe
    socket.onmessage = function (message) {
        //convert the binary event stream message to JSON
        let messageWrapper = eventStreamMarshaller.unmarshall(Buffer(message.data));
        let messageBody = JSON.parse(String.fromCharCode.apply(String, messageWrapper.body));
        if (messageWrapper.headers[":message-type"].value === "event") {
            handleEventStreamMessage(messageBody);
        }
        else {
            transcribeException = true;
            showError(messageBody.Message);
            toggleStartStop();
        }
    };

    socket.onerror = function () {
        socketError = true;
        showError('WebSocket connection error. Try again.');
        toggleStartStop();
    };
    
    socket.onclose = function (closeEvent) {
        micStream.stop();
        
        // the close event immediately follows the error event; only handle one.
        if (!socketError && !transcribeException) {
            if (closeEvent.code != 1000) {
                showError('</i><strong>Streaming Exception</strong><br>' + closeEvent.reason);
            }
            toggleStartStop();
        }
    };
}

let handleEventStreamMessage = function (messageJson) {
    console.log("==function call==");
    let results = messageJson.Transcript.Results;

    if (results.length > 0) {
        if (results[0].Alternatives.length > 0) {
            let transcript = results[0].Alternatives[0].Transcript;

            // fix encoding for accented characters
            transcript = decodeURIComponent(escape(transcript));

            // update the textarea with the latest result
            $('#transcript').val(transcription + transcript + "\n");
            console.log("transcript: "+transcript);
            speechData = transcript;
            

            

            // if this transcript segment is final, add it to the overall transcription
            if (!results[0].IsPartial) {
                //scroll the textarea down
                $('#transcript').scrollTop($('#transcript')[0].scrollHeight);

                transcription += transcript + "\n";
            }
        }
    }
}

let closeSocket = function () {
    if (socket.readyState === socket.OPEN) {
        micStream.stop();

        // Send an empty frame so that Transcribe initiates a closure of the WebSocket after submitting all transcripts
        let emptyMessage = getAudioEventMessage(Buffer.from(new Buffer([])));
        let emptyBuffer = eventStreamMarshaller.marshall(emptyMessage);
        socket.send(emptyBuffer);
    }
}

$('#stop-button').click(function () {
    closeSocket();
    toggleStartStop();
    $('#responsePlay').attr("disabled", false);
});

$('#reset-button').click(function (){
    $('#transcript').val('');
    transcription = '';
});

function toggleStartStop(disableStart = false) {
    $('#start-button').prop('disabled', disableStart);
    $('#stop-button').attr("disabled", !disableStart);
}

function showError(message) {
    $('#error').html('<i class="fa fa-times-circle"></i> ' + message);
    $('#error').show();
}

function convertAudioToBinaryMessage(audioChunk) {
    let raw = mic.toRaw(audioChunk);

    if (raw == null)
        return;

    // downsample and convert the raw audio bytes to PCM
    let downsampledBuffer = audioUtils.downsampleBuffer(raw, inputSampleRate, sampleRate);
    let pcmEncodedBuffer = audioUtils.pcmEncode(downsampledBuffer);

    // add the right JSON headers and structure to the message
    let audioEventMessage = getAudioEventMessage(Buffer.from(pcmEncodedBuffer));

    //convert the JSON object + headers into a binary event stream message
    let binary = eventStreamMarshaller.marshall(audioEventMessage);

    return binary;
}

function getAudioEventMessage(buffer) {
    // wrap the audio data in a JSON envelope
    return {
        headers: {
            ':message-type': {
                type: 'string',
                value: 'event'
            },
            ':event-type': {
                type: 'string',
                value: 'AudioEvent'
            }
        },
        body: buffer
    };
}

function createPresignedUrl() {
    let endpoint = "transcribestreaming." + region + ".amazonaws.com:8443";

    // get a preauthenticated URL that we can use to establish our WebSocket
    return v4.createPresignedURL(
        'GET',
        endpoint,
        '/stream-transcription-websocket',
        'transcribe',
        crypto.createHash('sha256').update('', 'utf8').digest('hex'), {
            'key': $('#access_id').val(),
            'secret': $('#secret_key').val(),
            'sessionToken': $('#session_token').val(),
            'protocol': 'wss',
            'expires': 15,
            'region': region,
            'query': "language-code=" + languageCode + "&media-encoding=pcm&sample-rate=" + sampleRate
        }
    );
}
