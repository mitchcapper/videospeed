/* Shared between inject.js and options.js */
var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
var regEndsWithFlags = /\/(?!.*(.).*\1)[gimsuy]*$/;
var SettingFieldsSynced = ["keyBindings","version","displayKeyCode","rememberSpeed","forceLastSavedSpeed","audioBoolean","startHidden","lastSpeed",
"enabled","controllerOpacity","logLevel","blacklist","ifSpeedIsNormalDontSaveUnlessWeSetIt","ytAutoEnableClosedCaptions","ytAutoDisableAutoPlay"];
 ///"ytJS" sadly cant figure out a good way to execute js https://bugs.chromium.org/p/chromium/issues/detail?id=1207006 may eventually have a solution
var SettingFieldsBeforeSync = new Map();
SettingFieldsBeforeSync.set("blacklist",(data) => data.replace(regStrip, ""));
let syncFieldObj = {};
for (let field of SettingFieldsSynced)
  syncFieldObj[field] = true;

var tcDefaults = {
  version: "0.5.3",
  lastSpeed: 1.0, // default:
  displayKeyCode: 86, // default: V
  rememberSpeed: false, // default: false
  audioBoolean: false, // default: false
  startHidden: false, // default: false
  forceLastSavedSpeed: false, //default: false
  enabled: true, // default enabled
  controllerOpacity: 0.3, // default: 0.3
  logLevel: 3, // default: 3
  defaultLogLevel: 4, //for any command that doesn't specify a log level
  speeds: {}, // empty object to hold speed for each source
  ifSpeedIsNormalDontSaveUnlessWeSetIt: false,
  ytAutoEnableClosedCaptions: false,
  ytAutoDisableAutoPlay: false,
  keyBindings: [
    { action: "display", key: 86, value: 0, force: false, predefined: true }, // V
    { action: "slower", key: 83, value: 0.1, force: false, predefined: true }, // S
    { action: "faster", key: 68, value: 0.1, force: false, predefined: true }, // D
    { action: "rewind", key: 90, value: 10, force: false, predefined: true }, // Z
    { action: "advance", key: 88, value: 10, force: false, predefined: true }, // X
    { action: "reset", key: 82, value: 1, force: false, predefined: true }, // R
    { action: "fast", key: 71, value: 1.8, force: false, predefined: true } // G
  ],
  blacklist: `www.instagram.com
    twitter.com
    imgur.com
    teams.microsoft.com
  `.replace(regStrip, ""),
  // Holds a reference to all of the AUDIO/VIDEO DOM elements we've attached to
  mediaElements: []
};
/* End Shared between inject.js and options.js */

var tc = {
  settings: {
    ...tcDefaults
  },
  // Holds a reference to all of the AUDIO/VIDEO DOM elements we've attached to
  mediaElements: []
};

for (let field of SettingFieldsSynced){
  if (tcDefaults[field] === undefined)
    log(`Warning a field we sync: ${field} not found on our tc.settings class likely error`,3);
}
/* Log levels (depends on caller specifying the correct level)
  1 - none
  2 - error
  3 - warning
  4 - info
  5 - debug
  6 - debug high verbosity + stack trace on each message
*/
function log(message, level, instId=null) {
  verbosity = tc.settings.logLevel;
  if (! instId)
    instId="";
  else
    instId=` (${instId})`;
  message = `${log.caller?.name ?? "null"}${instId}: ${message}`;
  if (typeof level === "undefined") {
    level = tc.settings.defaultLogLevel;
  }
  if (verbosity >= level) {
    if (level === 2) {
      console.log("vsc ERROR:" + message);
    } else if (level === 3) {
      console.log("vsc WARNING:" + message);
    } else if (level === 4) {
      console.log("vsc INFO:" + message);
    } else if (level === 5) {
      console.log("vsc DEBUG:" + message);
    } else if (level === 6) {
      console.log("vsc DEBUG (VERBOSE):" + message);
      console.trace();
    }
  }
}

function GetStorage(keys) {
  if (window.browser?.storage?.sync?.get)
      return browser.storage.sync.get(keys);
  
  return new Promise(resolve => chrome.storage.sync.get(keys, resolve));
}
async function Start(){
  log("Starting Up",5);
  const storage = await GetStorage(tc.settings);
  tc.settings.keyBindings = storage.keyBindings; // Array
  if (storage.keyBindings.length == 0) {
    storage.keyBindings = [ ...tcDefaults.keyBindings];
    tc.settings.version = tcDefaults.version;
    let toSet = {};
    for (let _field of SettingFieldsSynced){
      let val = tc.settings[_field];
      if (SettingFieldsBeforeSync.has(_field))
        val = SettingFieldsBeforeSync.get(_field)(val);
      toSet[_field] = val;
    }
    chrome.storage.sync.set(toSet);
  }
  for (let field of SettingFieldsSynced){
    let origType = typeof(tcDefaults[field]);
    switch (origType){
        case "string":
          tc.settings[field] = String(storage[field]);
          break;
        case "number":
            tc.settings[field] = Number(storage[field]);
          break;
        case "boolean":
          tc.settings[field] = Boolean(storage[field]);
          break;
        default:
          tc.settings[field] = storage[field];
          break;
    }
  }

  // ensure that there is a "display" binding (for upgrades from versions that had it as a separate binding)
  if (
    tc.settings.keyBindings.filter((x) => x.action == "display").length == 0
  ) {
    tc.settings.keyBindings.push({
      action: "display",
      key: Number(storage.displayKeyCode) || 86,
      value: 0,
      force: false,
      predefined: true
    }); // default V
  }

  initializeWhenReady(document);
}
Start();

function getKeyBindings(action, what = "value") {
  try {
    return tc.settings.keyBindings.find((item) => item.action === action)[what];
  } catch (e) {
    return false;
  }
}

function setKeyBindings(action, value) {
  tc.settings.keyBindings.find((item) => item.action === action)[
    "value"
  ] = value;
}
var VSC_INST_ID=124;

function defineVideoController() {
  // Data structures
  // ---------------
  // videoController (JS object) instances:
  //   video = AUDIO/VIDEO DOM element
  //   parent = A/V DOM element's parentElement OR
  //            (A/V elements discovered from the Mutation Observer)
  //            A/V element's parentNode OR the node whose children changed.
  //   div = Controller's DOM element (which happens to be a DIV)
  //   speedIndicator = DOM element in the Controller of the speed indicator

  // added to AUDIO / VIDEO DOM elements
  //    vsc = reference to the videoController
  tc.videoController = function (target, parent) {
    if (target.vsc) {
      return target.vsc;
    }

    tc.mediaElements.push(target);
    this.INST_ID = VSC_INST_ID++;
    log(`Initializing on element: ${getVideoIdent(target)}`, 5, this.INST_ID);

    this.video = target;
    this.parent = target.parentElement || parent;
    storedSpeed = tc.settings.speeds[target.currentSrc];
    if (!tc.settings.rememberSpeed) {
      if (!storedSpeed) {
        log(
          "Overwriting stored speed to 1.0 due to rememberSpeed being disabled",
          5, this.INST_ID
        );
        storedSpeed = 1.0;
      }
      setKeyBindings("reset", getKeyBindings("fast")); // resetSpeed = fastSpeed
    } else {
      storedSpeed = tc.settings.lastSpeed;
      log(`Recalled stored speed due to rememberSpeed being enabled: ${storedSpeed}`, 5, this.INST_ID);
    }

    log("Explicitly setting playbackRate to: " + storedSpeed, 5, this.INST_ID);
    target.playbackRate = storedSpeed;

    this.div = this.initializeControls();

    var mediaEventAction = function (event) {
      storedSpeed = tc.settings.speeds[event.target.currentSrc];
      if (!tc.settings.rememberSpeed) {
        if (!storedSpeed) {
          log("Overwriting stored speed to 1.0 (rememberSpeed not enabled)", 4, this.INST_ID);
          storedSpeed = 1.0;
        }
        // resetSpeed isn't really a reset, it's a toggle
        log("Setting reset keybinding to fast", 5);
        setKeyBindings("reset", getKeyBindings("fast")); // resetSpeed = fastSpeed
      } else {
        // log(
        //   "Storing lastSpeed into tc.settings.speeds (rememberSpeed enabled)",
        //   5
        // );
        log("Recalling stored speed due to rememberSpeed being enabled_", 5, this.INST_ID);
        storedSpeed = tc.settings.lastSpeed;
      }
      // TODO: Check if explicitly setting the playback rate to 1.0 is
      // necessary when rememberSpeed is disabled (this may accidentally
      // override a website's intentional initial speed setting interfering
      // with the site's default behavior)
      log("Explicitly setting playbackRate to: " + storedSpeed, 4, this.INST_ID);
      setSpeed(event.target, storedSpeed);
    };

    target.addEventListener(
      "play",
      (this.handlePlay = mediaEventAction.bind(this))
    );

    target.addEventListener(
      "seeked",
      (this.handleSeek = mediaEventAction.bind(this))
    );

    var targetObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          (mutation.attributeName === "src" ||
            mutation.attributeName === "currentSrc")
        ) {
          log(`mutation of A/V element src: ${mutation.target.src} and currentSrc: ${mutation.target.currentSrc}`, 5);
          var controller = this.div;
          if (!mutation.target.src && !mutation.target.currentSrc) {
            controller.classList.add("vsc-nosource");
          } else {
            controller.classList.remove("vsc-nosource");
          }
        }
      });
    });
    targetObserver.observe(target, {
      attributeFilter: ["src", "currentSrc"]
    });
  };

  tc.videoController.prototype.remove = function () {
    this.div.remove();
    this.video.removeEventListener("play", this.handlePlay);
    this.video.removeEventListener("seek", this.handleSeek);
    delete this.video.vsc;
    let idx = tc.mediaElements.indexOf(this.video);
    if (idx != -1) {
      tc.mediaElements.splice(idx, 1);
    }
  };

  tc.videoController.prototype.initializeControls = function () {
    log("initializeControls Begin", 5, this.INST_ID);
    const document = this.video.ownerDocument;
    const speed = this.video.playbackRate.toFixed(2);
    const rect = this.video.getBoundingClientRect();
    // getBoundingClientRect is relative to the viewport; style coordinates
    // are relative to offsetParent, so we adjust for that here. offsetParent
    // can be null if the video has `display: none` or is not yet in the DOM.
    const offsetRect = this.video.offsetParent?.getBoundingClientRect();
    const top = Math.max(rect.top - (offsetRect?.top || 0), 0) + "px";
    const left = Math.max(rect.left - (offsetRect?.left || 0), 0) + "px";

    log("Speed variable set to: " + speed, 5, this.INST_ID);

    var wrapper = document.createElement("div");
    wrapper.classList.add("vsc-controller");

    if (!this.video.currentSrc) {
      wrapper.classList.add("vsc-nosource");
    }

    if (tc.settings.startHidden) {
      wrapper.classList.add("vsc-hidden");
    }

    var shadow = wrapper.attachShadow({ mode: "open" });
    var shadowTemplate = `
        <style>
          @import "${chrome.runtime.getURL("shadow.css")}";
        </style>

        <div id="controller" style="top:${top}; left:${left}; opacity:${
      tc.settings.controllerOpacity
    }">
          <span data-action="drag" class="draggable">${speed}</span>
          <span id="controls">
            <button data-action="rewind" class="rw">«</button>
            <button data-action="slower">&minus;</button>
            <button data-action="faster">&plus;</button>
            <button data-action="advance" class="rw">»</button>
            <button data-action="display" class="hideButton">&times;</button>
          </span>
        </div>
      `;
    shadow.innerHTML = shadowTemplate;
    shadow.querySelector(".draggable").addEventListener(
      "mousedown",
      (e) => {
        runAction(e.target.dataset["action"], false, e);
        e.stopPropagation();
      },
      true
    );

    shadow.querySelectorAll("button").forEach(function (button) {
      button.addEventListener(
        "click",
        (e) => {
          runAction(
            e.target.dataset["action"],
            getKeyBindings(e.target.dataset["action"]),
            e
          );
          e.stopPropagation();
        },
        true
      );
    });

    shadow
      .querySelector("#controller")
      .addEventListener("click", (e) => e.stopPropagation(), false);
    shadow
      .querySelector("#controller")
      .addEventListener("mousedown", (e) => e.stopPropagation(), false);

    this.speedIndicator = shadow.querySelector("span");
    var fragment = document.createDocumentFragment();
    fragment.appendChild(wrapper);

    switch (true) {
      // Only special-case Prime Video, not product-page videos (which use
      // "vjs-tech"), otherwise the overlay disappears in fullscreen mode
      case location.hostname == "www.amazon.com" && !this.video.classList.contains("vjs-tech"):
      case location.hostname == "www.reddit.com":
      case /hbogo\./.test(location.hostname):
        // insert before parent to bypass overlay
        if (this.parent?.parentElement)
          this.parent.parentElement.insertBefore(fragment, this.parent);
        break;
      case location.hostname == "www.facebook.com":
        // this is a monstrosity but new FB design does not have *any*
        // semantic handles for us to traverse the tree, and deep nesting
        // that we need to bubble up from to get controller to stack correctly
        let p = this.parent?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
        if (p)
          p.insertBefore(fragment, p.firstChild);
        break;
      case location.hostname == "tv.apple.com":
        // insert before parent to bypass overlay
        this.parent.parentNode.insertBefore(fragment, this.parent.parentNode.firstChild);
        break;
      default:
        // Note: when triggered via a MutationRecord, it's possible that the
        // target is not the immediate parent. This appends the controller as
        // the first element of the target, which may not be the parent.
        this.parent.insertBefore(fragment, this.parent.firstChild);
    }
    return wrapper;
  };
}

function escapeStringRegExp(str) {
  matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;
  return str.replace(matchOperatorsRe, "\\$&");
}

function isBlacklisted() {
  blacklisted = false;
  tc.settings.blacklist.split("\n").forEach((match) => {
    match = match.replace(regStrip, "");
    if (match.length == 0) {
      return;
    }

    if (match.startsWith("/")) {
      try {
        var parts = match.split("/");

        if (regEndsWithFlags.test(match)) {
          var flags = parts.pop();
          var regex = parts.slice(1).join("/");
        } else {
          var flags = "";
          var regex = match;
        }

        var regexp = new RegExp(regex, flags);
      } catch (err) {
        return;
      }
    } else {
      var regexp = new RegExp(escapeStringRegExp(match));
    }

    if (regexp.test(location.href)) {
      blacklisted = true;
      return;
    }
  });
  return blacklisted;
}

var coolDown = false;
function refreshCoolDown() {
  log("Begin refreshCoolDown", 5);
  if (coolDown) {
    clearTimeout(coolDown);
  }
  coolDown = setTimeout(function () {
    coolDown = false;
  }, 1000);
  log("End refreshCoolDown", 5);
}
function getVideoIdent(video){
  if (! video)
    return "vid is null";
  return `${video.className} ${video.id} ${video.name} ${video.url} ${video.offsetWidth}x${video.offsetHeight}`;
}
function setupListener() {
  /**
   * This function is run whenever a video speed rate change occurs.
   * It is used to update the speed that shows up in the display as well as save
   * that latest speed into the local storage.
   *
   * @param {*} video The video element to update the speed indicators for.
   */
  function updateSpeedFromEvent(video, event) {
    // It's possible to get a rate change on a VIDEO/AUDIO that doesn't have
    // a video controller attached to it.  If we do, ignore it.
    if (!video.vsc)
      return;
    var speedIndicator = video.vsc.speedIndicator;
    var src = video.currentSrc;
    var speed = Number(video.playbackRate.toFixed(2));
    var ident = getVideoIdent(video);
    log("Playback rate changed to " + speed + ` for: ${ident}`, 4, video.vsc.INST_ID);
    //console.log(event);

    log("Updating controller with new speed", 5, video.vsc.INST_ID);
    speedIndicator.textContent = speed.toFixed(2);
    tc.settings.speeds[src] = speed;
    let wasUs = event.detail && event.detail.origin === "videoSpeed";
    if (wasUs || ! tc.settings.ifSpeedIsNormalDontSaveUnlessWeSetIt || speed != 1) {

      log("Storing lastSpeed in settings for the rememberSpeed feature", 5, video.vsc.INST_ID);
      tc.settings.lastSpeed = speed;
      log("Syncing chrome settings for lastSpeed", 5, video.vsc.INST_ID);
      chrome.storage.sync.set({ lastSpeed: speed }, function () {
        log("Speed setting saved: " + speed, 5, video.vsc.INST_ID);
      });
    } else
      log(`Speed update to ${speed} ignored due to ifSpeedIsNormalDontSaveUnlessWeSetIt`,5, video.vsc.INST_ID);
    // show the controller for 1000ms if it's hidden.
    runAction("blink", null, null);
  }

  document.addEventListener(
    "ratechange",
    function (event) {
      if (coolDown) {
        log("Speed event propagation blocked as on cooldown", 4);
        event.stopImmediatePropagation();
      }
      /**
       * Normally we'd do 'event.target' here. But that doesn't work with shadow DOMs. For
       * an event that bubbles up out of a shadow DOM, event.target is the root of the shadow
       * DOM. For 'open' shadow DOMs, event.composedPath()[0] is the actual element that will
       * first receive the event, and it's equivalent to event.target in non-shadow-DOM cases.
       */
      var video = event.composedPath()[0];

      /**
       * If the last speed is forced, only update the speed based on events created by
       * video speed instead of all video speed change events.
       */
      if (tc.settings.forceLastSavedSpeed) {
        if (event.detail && event.detail.origin === "videoSpeed") {
          video.playbackRate = event.detail.speed;
          updateSpeedFromEvent(video, event);
        } else {
          log(`Speed ratechange event of speed ${event.detail?.speed ?? video.playbackRate} ignored and setting back to our last speed due to videoSpeedEventAction setting source video: ${getVideoIdent(video)}`, 5, video.INST_ID);
          video.playbackRate = tc.settings.lastSpeed;
        }
        event.stopImmediatePropagation();
      } else {
        updateSpeedFromEvent(video, event);
      }
    },
    true
  );
}

function initializeWhenReady(document) {
  log("Begin initializeWhenReady", 5);
  if (isBlacklisted()) {
    return;
  }
  window.onload = () => {
    initializeNow(window.document);
  };
  if (document) {
    if (document.readyState === "complete") {
      initializeNow(document);
    } else {
      document.onreadystatechange = () => {
        if (document.readyState === "complete") {
          initializeNow(document);
        }
      };
    }
  }
  log("End initializeWhenReady", 5);
}
function inIframe() {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}
function getShadow(parent) {
  let result = [];
  function getChild(parent) {
    if (parent.firstElementChild) {
      var child = parent.firstElementChild;
      do {
        result.push(child);
        getChild(child);
        if (child.shadowRoot) {
          result.push(getShadow(child.shadowRoot));
        }
        child = child.nextElementSibling;
      } while (child);
    }
  }
  getChild(parent);
  return result.flat(Infinity);
}

function initializeNow(document) {
  log(`Begin initializeNow for url ${document.location?.href}`, 5);
  if (!tc.settings.enabled) return;
  // enforce init-once due to redundant callers
  if (!document.body || document.body.classList.contains("vsc-initialized")) {
    return;
  }
  try {
    setupListener();
  } catch {
    // no operation
  }
  document.body.classList.add("vsc-initialized");
  log("initializeNow: vsc-initialized added to document body", 5);

  injectScriptForSite();

  if (document === window.document) {
    defineVideoController();
  } else {
    var link = document.createElement("link");
    link.href = chrome.runtime.getURL("inject.css");
    link.type = "text/css";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  var docs = Array(document);
  try {
    if (inIframe()) docs.push(window.top.document);
  } catch (e) {}

  docs.forEach(function (doc) {
    doc.addEventListener(
      "keydown",
      function (event) {
        var keyCode = event.keyCode;
        log("Processing keydown event: " + keyCode, 6);

        // Ignore if following modifier is active.
        if (
          !event.getModifierState ||
          event.getModifierState("Alt") ||
          event.getModifierState("Control") ||
          event.getModifierState("Fn") ||
          event.getModifierState("Meta") ||
          event.getModifierState("Hyper") ||
          event.getModifierState("OS")
        ) {
          log("Keydown event ignored due to active modifier: " + keyCode, 5);
          return;
        }

        // Ignore keydown event if typing in an input box
        if (
          event.target.nodeName === "INPUT" ||
          event.target.nodeName === "TEXTAREA" ||
          event.target.isContentEditable
        ) {
          return false;
        }

        // Ignore keydown event if typing in a page without vsc
        if (!tc.mediaElements.length) {
          return false;
        }

        var item = tc.settings.keyBindings.find((item) => item.key === keyCode);
        if (item) {
          runAction(item.action, item.value);
          if (item.force === "true") {
            // disable websites key bindings
            event.preventDefault();
            event.stopPropagation();
          }
        }

        return false;
      },
      true
    );
  });

  function checkForVideoAndShadowRoot(node, parent, added) {
    // Only proceed with supposed removal if node is missing from DOM
    if (!added && document.body?.contains(node)) {
      // This was written prior to the addition of shadowRoot processing.
      // TODO: Determine if shadowRoot deleted nodes need this sort of 
      // check as well.
      return;
    }
    if (
      node.nodeName === "VIDEO" ||
      (node.nodeName === "AUDIO" && tc.settings.audioBoolean)
    ) {
      if (added) {
        node.vsc = new tc.videoController(node, parent);
      } else {
        if (node.vsc) {
          node.vsc.remove();
        }
      }
    } else {
      var children = [];
      if (node.shadowRoot) {
        documentAndShadowRootObserver.observe(node.shadowRoot, documentAndShadowRootObserverOptions);
        children = Array.from(node.shadowRoot.children);
      }
      if (node.children) {
        children = [...children, ...node.children];
      };
      for (const child of children) {
        checkForVideoAndShadowRoot(child, child.parentNode || parent, added)
      };
    }
  }

  var documentAndShadowRootObserver = new MutationObserver(function (mutations) {
    // Process the DOM nodes lazily
    requestIdleCallback(
      (_) => {
        mutations.forEach(function (mutation) {
          switch (mutation.type) {
            case "childList":
              mutation.addedNodes.forEach(function (node) {
                if (typeof node === "function") return;
                if (node === document.documentElement) {
                  // This happens on sites that use document.write, e.g. watch.sling.com
                  // When the document gets replaced, we lose all event handlers, so we need to reinitialize
                  log("Document was replaced, reinitializing", 5);
                  initializeWhenReady(document);
                  return;
                }
                checkForVideoAndShadowRoot(node, node.parentNode || mutation.target, true);
              });
              mutation.removedNodes.forEach(function (node) {
                if (typeof node === "function") return;
                checkForVideoAndShadowRoot(node, node.parentNode || mutation.target, false);
              });
              break;
            case "attributes":
              if (
                (mutation.target.attributes["aria-hidden"] &&
                mutation.target.attributes["aria-hidden"].value == "false")
                || mutation.target.nodeName === 'APPLE-TV-PLUS-PLAYER'
              ) {
                var flattenedNodes = getShadow(document.body);
                var nodes = flattenedNodes.filter(
                  (x) => x.tagName == "VIDEO"
                );
                for (let node of nodes) {
                  // only add vsc the first time for the apple-tv case (the attribute change is triggered every time you click the vsc)
                  if (node.vsc && mutation.target.nodeName === 'APPLE-TV-PLUS-PLAYER')
                    continue;
                  if (node.vsc)
                    node.vsc.remove();
                  checkForVideoAndShadowRoot(node, node.parentNode || mutation.target, true);
                }
              }
              break;
          }
        });
      },
      { timeout: 1000 }
    );
  });
  documentAndShadowRootObserverOptions = {
    attributeFilter: ["aria-hidden", "data-focus-method"],
    childList: true,
    subtree: true
  }
  documentAndShadowRootObserver.observe(document, documentAndShadowRootObserverOptions);

  const mediaTagSelector = tc.settings.audioBoolean ? "video,audio" : "video";
  mediaTags = Array.from(document.querySelectorAll(mediaTagSelector));

  document.querySelectorAll("*").forEach((element) => {
    if (element.shadowRoot) {
      documentAndShadowRootObserver.observe(element.shadowRoot, documentAndShadowRootObserverOptions);
      mediaTags.push(...element.shadowRoot.querySelectorAll(mediaTagSelector));
    };
  });

  mediaTags.forEach(function (video) {
    video.vsc = new tc.videoController(video);
  });

  var frameTags = document.getElementsByTagName("iframe");
  Array.prototype.forEach.call(frameTags, function (frame) {
    // Ignore frames we don't have permission to access (different origin).
    try {
      var childDocument = frame.contentDocument;
    } catch (e) {
      return;
    }
    initializeWhenReady(childDocument);
  });
  log("End initializeNow", 5);

  if ( window.location.hostname.endsWith("youtube.com") )
    setTimeout(YTComAfterLoaded,1000);
    //eval(tc.settings.ytJS);

}
function domItemByClass(classname){
  var subButton = document.getElementsByClassName("ytp-subtitles-button ytp-button");
  return subButton.length < 1 ? null : subButton[0];
}
function YTComAfterLoaded(){
  if (tc.settings.ytAutoEnableClosedCaptions) {
    let subButton = domItemByClass("ytp-subtitles-button ytp-button");
    if (subButton && subButton.getAttribute("aria-pressed") == 'false')
      subButton.click();
  }
  if (tc.settings.ytAutoDisableAutoPlay){
    let subButton = domItemByClass("ytp-autonav-toggle-button");
    if (subButton && subButton.getAttribute("aria-checked") == 'true')
      subButton.click();
  }
}
function setSpeed(video, speed) {
  log("setSpeed started: " + speed, 5);
  var speedvalue = speed.toFixed(2);
  if (tc.settings.forceLastSavedSpeed) {
    video.dispatchEvent(
      new CustomEvent("ratechange", {
        // bubbles and composed are needed to allow event to 'escape' open shadow DOMs
        bubbles: true,
        composed: true,
        detail: { origin: "videoSpeed", speed: speedvalue }
      })
    );
  } else {
    video.playbackRate = Number(speedvalue);
  }
  var speedIndicator = video.vsc.speedIndicator;
  speedIndicator.textContent = speedvalue;
  tc.settings.lastSpeed = speed;
  refreshCoolDown();
  log("setSpeed finished: " + speed, 5);
}

function runAction(action, value, e) {
  log("runAction Begin", 5);

  var mediaTags = tc.mediaElements;

  // Get the controller that was used if called from a button press event e
  if (e) {
    var targetController = e.target.getRootNode().host;
  }

  mediaTags.forEach(function (v) {
    var controller = v.vsc.div;

    // Don't change video speed if the video has a different controller
    if (e && !(targetController == controller)) {
      return;
    }

    showController(controller);

    if (!v.classList.contains("vsc-cancelled")) {
      if (action === "rewind") {
        log("Rewind", 5, v.vsc.INST_ID);
        seek(v, -value);
      } else if (action === "advance") {
        log("Fast forward", 5, v.vsc.INST_ID);
        seek(v, value);
      } else if (action === "faster") {
        log("Increase speed", 5, v.vsc.INST_ID);
        // Maximum playback speed in Chrome is set to 16:
        // https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/html/media/html_media_element.h;l=117;drc=70155ab40e50115ac8cff6e8f4b7703a7784d854
        var s = Math.min(
          (v.playbackRate < 0.1 ? 0.0 : v.playbackRate) + value,
          16
        );
        setSpeed(v, s);
      } else if (action === "slower") {
        log("Decrease speed", 5, v.vsc.INST_ID);
        // Video min rate is 0.0625:
        // https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/html/media/html_media_element.h;l=116;drc=70155ab40e50115ac8cff6e8f4b7703a7784d854
        var s = Math.max(v.playbackRate - value, 0.07);
        setSpeed(v, s);
      } else if (action === "reset") {
        log("Reset speed", 5, v.vsc.INST_ID);
        resetSpeed(v, 1.0);
      } else if (action === "display") {
        log("Showing controller", 5, v.vsc.INST_ID);
        controller.classList.add("vsc-manual");
        controller.classList.toggle("vsc-hidden");
      } else if (action === "blink") {
        log("Showing controller momentarily", 5, v.vsc.INST_ID);
        // if vsc is hidden, show it briefly to give the use visual feedback that the action is excuted.
        if (
          controller.classList.contains("vsc-hidden") ||
          controller.blinkTimeOut !== undefined
        ) {
          clearTimeout(controller.blinkTimeOut);
          controller.classList.remove("vsc-hidden");
          controller.blinkTimeOut = setTimeout(
            () => {
              controller.classList.add("vsc-hidden");
              controller.blinkTimeOut = undefined;
            },
            value ? value : 1000
          );
        }
      } else if (action === "drag") {
        handleDrag(v, e);
      } else if (action === "fast") {
        resetSpeed(v, value);
      } else if (action === "pause") {
        pause(v);
      } else if (action === "muted") {
        muted(v);
      } else if (action === "louder") {
        volumeUp(v, value);
      } else if (action === "softer") {
        volumeDown(v, value);
      } else if (action === "mark") {
        setMark(v);
      } else if (action === "jump") {
        jumpToMark(v);
      }
    }
  });
  log("runAction End", 5);
}

function injectScriptForSite() {
  const elt = document.createElement("script");
  switch (true) {
    case location.hostname == "www.netflix.com":
      elt.src= chrome.runtime.getURL('scriptforsite/netflix.js');
      break;
  }
  if (elt.src) {
    document.head.appendChild(elt);
  }
}

function seek(mediaTag, seekSeconds) {
  switch (true) {
    case location.hostname == "www.netflix.com":
      window.postMessage({action: "videospeed-seek", seekMs: seekSeconds * 1000}, "https://www.netflix.com");
      break;
    default:
      mediaTag.currentTime += seekSeconds;
  }
}

function pause(v) {
  if (v.paused) {
    log("Resuming video", 5);
    v.play();
  } else {
    log("Pausing video", 5);
    v.pause();
  }
}

function resetSpeed(v, target) {
  if (v.playbackRate === target) {
    if (v.playbackRate === getKeyBindings("reset")) {
      if (target !== 1.0) {
        log("Resetting playback speed to 1.0", 4);
        setSpeed(v, 1.0);
      } else {
        log('Toggling playback speed to "fast" speed', 4);
        setSpeed(v, getKeyBindings("fast"));
      }
    } else {
      log('Toggling playback speed to "reset" speed', 4);
      setSpeed(v, getKeyBindings("reset"));
    }
  } else {
    log('Toggling playback speed to "reset" speed', 4);
    setKeyBindings("reset", v.playbackRate);
    setSpeed(v, target);
  }
}

function muted(v) {
  v.muted = v.muted !== true;
}

function volumeUp(v, value) {
  v.volume = Math.min(1, (v.volume + value).toFixed(2));
}

function volumeDown(v, value) {
  v.volume = Math.max(0, (v.volume - value).toFixed(2));
}

function setMark(v) {
  log("Adding marker", 5, v.vsc.INST_ID);
  v.vsc.mark = v.currentTime;
}

function jumpToMark(v) {
  log("Recalling marker", 5, v.vsc.INST_ID);
  if (v.vsc.mark && typeof v.vsc.mark === "number") {
    v.currentTime = v.vsc.mark;
  }
}

function handleDrag(video, e) {
  const controller = video.vsc.div;
  const shadowController = controller.shadowRoot.querySelector("#controller");

  // Find nearest parent of same size as video parent.
  var parentElement = controller.parentElement;
  while (
    parentElement.parentNode &&
    parentElement.parentNode.offsetHeight === parentElement.offsetHeight &&
    parentElement.parentNode.offsetWidth === parentElement.offsetWidth
  ) {
    parentElement = parentElement.parentNode;
  }

  video.classList.add("vcs-dragging");
  shadowController.classList.add("dragging");

  const initialMouseXY = [e.clientX, e.clientY];
  const initialControllerXY = [
    parseInt(shadowController.style.left),
    parseInt(shadowController.style.top)
  ];

  const startDragging = (e) => {
    let style = shadowController.style;
    let dx = e.clientX - initialMouseXY[0];
    let dy = e.clientY - initialMouseXY[1];
    style.left = initialControllerXY[0] + dx + "px";
    style.top = initialControllerXY[1] + dy + "px";
  };

  const stopDragging = () => {
    parentElement.removeEventListener("mousemove", startDragging);
    parentElement.removeEventListener("mouseup", stopDragging);
    parentElement.removeEventListener("mouseleave", stopDragging);

    shadowController.classList.remove("dragging");
    video.classList.remove("vcs-dragging");
  };

  parentElement.addEventListener("mouseup", stopDragging);
  parentElement.addEventListener("mouseleave", stopDragging);
  parentElement.addEventListener("mousemove", startDragging);
}

var timer = null;
function showController(controller) {
  log("Showing controller", 4);
  controller.classList.add("vcs-show");

  if (timer) clearTimeout(timer);

  timer = setTimeout(function () {
    controller.classList.remove("vcs-show");
    timer = false;
    log("Hiding controller", 5);
  }, 2000);
}
