class Keyer {
    constructor(sndr, decoder) {
        this.sndr = sndr; // Sounder instance
        this.decoder = decoder; // Decoder instance
        // Using [ and ] for dits and dahs respectively for compatibility with the vband usb interface
        this.ditKey1 = 'ControlLeft';
        this.dahKey1 = 'ControlRight';
        this.ditKey2 = 'BracketLeft';
        this.dahKey2 = 'BracketRight';
        this.wpm = 20;
        this.unit = 60; // length of dit in milliseconds; 60 is 20wpm
        this.mode = 2;  // 1: straight key, 2: iambicA, 3: iambicB, 4: ultimatic
        this.tone = 550;
        this.queue = [];
        this.ditKeyState = 0;
        this.dahKeyState = 0;
        this.lastKey = null;
        this.ditStreak = 0;
        this.dahStreak = 0;
        this.streak = 0;
        this.ditStart = null;
        this.ditStop = null;
        this.dahStart = null;
        this.dahStop = null;
        this.sending = false;
        this.lastSendTimestamp = null;
        // Track active keys in straight key mode to handle multiple simultaneous key presses
        this.straightKeyActive = false;
        this.activeKeys = new Set();
        this.oscillatorTimer = setInterval(() => {
            this.oscillate();
        }, 0);
    }

    setWpm(wpm){
        this.wpm = wpm;
        this.unit = 60000 / (wpm * 50)  // based on the PARIS method 60 seconds / 50 elements per word * WPM
        this.decoder.unit = this.unit;
    }

    setMode(mode){
        this.mode = mode;
    }

    setTone(tone){
        this.tone = tone;
    }

    sendSignal() {
        this.sending = true;
        //console.log('startSignal');
        if (restartAudioNeeded()) {
            restartAudio();
        }
        this.sndr.setTone(this.tone);
        this.sndr.on();
        this.decoder.keyOn();
    }

    stopSignal() {
        //console.log('stopSignal');
        this.sndr.off();
        this.decoder.keyOff();
        this.lastSendTimestamp = Date.now();
        setTimeout(() => {
            this.sending = false;
        }, this.unit);
    }

    press(event, down, mode=this.mode) {
        if (mode > 1 && event.code != this.ditKey1 && event.code != this.dahKey1 && event.code != this.ditKey2 && event.code != this.dahKey2) return;
        if (mode == 1) {
            // In straight key mode, handle all four possible keys
            const isValidKey = event.code === this.ditKey1 || event.code === this.dahKey1 || 
                            event.code === this.ditKey2 || event.code === this.dahKey2;
            if (!isValidKey) return;
            
            if (down) {
                // Add this key to our active keys set
                this.activeKeys.add(event.code);
                
                // If we're not already active, turn on the sound
                if (!this.straightKeyActive) {
                    if (restartAudioNeeded()) {
                        restartAudio();
                    }
                    this.straightKeyActive = true;
                    this.sndr.setTone(this.tone);
                    this.sndr.on();
                    this.decoder.keyOn();
                }
                // If already active, do nothing (prevents double triggering)
            } else {
                // Remove this key from our active keys set
                this.activeKeys.delete(event.code);
                
                // Only turn off sound if ALL keys are released
                if (this.activeKeys.size === 0) {
                    this.straightKeyActive = false;
                    this.sndr.off();
                    this.decoder.keyOff();
                }
            }
        } else if (mode > 1) {
            //console.log(key);
            if (event.code == this.ditKey1 || event.code == this.ditKey2) {
                if (down) { // dit key down
                    this.ditKeyState = 1;
                    this.ditStart = Date.now()
                } else { // dit key up
                    this.ditKeyState = 0;
                    this.ditStop = Date.now()
                }
            }
            if (event.code == this.dahKey1 || event.code == this.dahKey2) {
                if (down) { // dah key down
                    this.dahKeyState = 1;
                    this.dahStart = Date.now()
                } else { // dah key up
                    this.dahKeyState = 0;
                    this.dahStop = Date.now()
                }
            }
        }
    }

    processQueue() {
        //console.log('processQueue');
        if (!this.sending && this.queue.length) {
            this.lastKey = this.queue.shift();
            var signalLength = (this.lastKey == 1) ? this.unit : this.unit * 3;
            this.sendSignal();
            setTimeout(() => {
                this.stopSignal();
            }, signalLength);
        }
    }

    oscillatev1() {
        if (!this.ditKeyState && !this.dahKeyState) {
            this.queue = [];
        }
        if (this.ditKeyState) {
            if (this.queue.length == 0) {
                if (!this.dahKeyState && !this.sending || this.lastKey == 2) {
                    this.queue.push(1);
                }
            }
        }
        if (this.dahKeyState) {
            if (this.queue.length == 0) {
                if (!this.ditKeyState && !this.sending || this.lastKey == 1) {
                    this.queue.push(2);
                }
            }
        }
        if (!this.sending && Date.now() - this.lastSendTimestamp > this.unit) {
            this.processQueue();
        }
    }

    oscillatev2() {
        if (this.mode == 2 && !this.ditKeyState && !this.dahKeyState) { // Iambic B doesn't clear the queue
            if (this.streak > 1) {
                //console.log(this.streak + " queue: " + this.queue[0]);
                this.queue = [];
            }
            this.streak = 0;
        }
        if (this.ditKeyState) {
            if (this.queue.length < 1) {
                if (!this.sending || this.lastKey == 2) {
                    this.queue.push(1);
                    if (this.lastKey == 2 && this.dahKeyState) {
                        this.streak++;
                    } else {
                        this.streak = 0;
                    }
                }
            }
        }
        if (this.dahKeyState) {
            if (this.queue.length < 1) {
                if (!this.sending || this.lastKey == 1) {
                    this.queue.push(2);
                    if (this.lastKey == 1 && this.ditKeyState) {
                        this.streak++;
                    } else {
                        this.streak = 0;
                    }
                }
            }
        }
        if (!this.sending && Date.now() - this.lastSendTimestamp >= this.unit) {
            this.processQueue();
        }
    }

    oscillatev3() {
        if (this.mode == 2 && !this.ditKeyState && !this.dahKeyState && this.queue.length) { // Iambic B doesn't clear the queue
            if ((this.ditStreak && this.queue[0] == 1) || (this.dahStreak && this.queue[0] == 2)) {
                console.log("ditStreak: "+this.ditStreak+" dahStreak: "+this.dahStreak+" queue: "+this.queue[0]);
                this.queue = [];
            }
            //console.log("NO CLEAR ditStreak: "+this.ditStreak+" dahStreak: "+this.dahStreak+" queue: "+this.queue[0]);
            this.ditStreak = 0;
            this.dahStreak = 0;
        }
        if (this.ditKeyState) {
            if (!this.queue.length) {
                if (!this.sending || this.lastKey == 2) {
                    this.queue.push(1);
                    this.ditStreak++;
                }
            } else if (!this.dahKeyState && this.queue[0] == 2) { // dah was canceled.  Replace in queue
                this.queue[0] = 1;
                this.dahStreak = 0;
                this.ditStreak++;
            }
        }
        if (this.dahKeyState) {
            if (!this.queue.length) {
                if (!this.sending || this.lastKey == 1) {
                    this.queue.push(2);
                    this.dahStreak++;
                }
            } else if (!this.ditKeyState && this.queue[0] == 1) { // dit was canceled.  Replace in queue
                this.queue[0] = 2;
                this.ditStreak = 0;
                this.dahStreak++;
            }
        }
        if (!this.sending && Date.now() - this.lastSendTimestamp >= this.unit) {
            this.processQueue();
        }
    }

    oscillate() {
        if (this.mode == 2 && !this.ditKeyState && !this.dahKeyState && this.queue.length) {
            if (this.queue[0] == 1) { // Dit is in the queue
                if (this.ditStart < this.dahStart || this.ditStop - this.ditStart > this.unit * 4) {
                    this.queue.pop();
                }
            } else { // Dah is in the queue
                if (this.dahStart < this.ditStart || this.dahStop - this.dahStart > this.unit * 2) {
                    this.queue.pop();
                }
            }
        }
        if (this.ditKeyState) {
            if (this.queue.length == 0) {
                if ((!this.dahKeyState && !this.sending) || this.lastKey == 2) {
                    this.queue.push(1);
                }
            } else { // dah key was lifted and is still in queue
                if (this.mode == 2 && !this.dahKeyState && this.dahStart < this.ditStart && this.queue[0] == 2) {
                    this.queue.pop();
                }
            }
        }
        if (this.dahKeyState) {
            if (this.queue.length == 0) {
                if ((!this.ditKeyState && !this.sending) || this.lastKey == 1) {
                    this.queue.push(2);
                }
            } else { // dit key was lifted and is still in queue
                if (this.mode == 2 && !this.ditKeyState && this.ditStart < this.dahStart && this.queue[0] == 1) {
                    this.queue.pop();
                }
            }
        }
        if (!this.sending && Date.now() - this.lastSendTimestamp > this.unit) {
            this.processQueue();
        }
    }
}
