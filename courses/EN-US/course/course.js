
// namespace
var lnx = {

    exitHandled: false,


    // app entry point called via window onload event
    init: function() {

        lnx.config.init();
		
		if( !lnx.config.ignoreLMS ){
			lnx.scormApi.lmsInit();
		}

        // an included js that preloads images - optional, remove in low bandwidth circumstances
        if (lnx_preload && lnx_preload.run) {
            lnx_preload.run();
        }

        lnx.audio.init();
        lnx.util.init();
        lnx.overlayMan.init();
        window.addEventListener("resize", lnx.config.onResize, false);
        lnx.config.onResize();
    },


    // app exit point
    exit: function( closeWin ) {

        // lmsFinish will only be called more than once
        // if the LMS return false to a previous LMSFinish call
        if (!this.exitHandled) {
            if (lnx.scormApi.lmsFinish()) {
                this.exitHandled = true;
            }
        }

        try {
			lnx.assessment.fullDestroy();
            lnx.nav.destroy();
			lnx.util.destroy();
        } catch (e) {
            
        }

        if (closeWin) {
           top.window.close();
        }
    }
};

lnx.cache = {

    cache: {},

    setValue: function(k1, k2, v){
        if(!this.cache[k1]){
            this.cache[k1] = {};
        }
        this.cache[k1][k2] = v;
    },

    getValue: function(k1, k2){
        if(!this.cache[k1]) return null;
        return this.cache[k1][k2];
    }
};



// obj handles communications with lms api obj
// dependency on SCORM_12_APIWrapper.js which defines:
// doLMSInitialize, doLMSFinish, doLMSCommit, doLMSGetValue, doLMSSetValue
lnx.scormApi = {


    CMI: {
        LESSON_STATUS: "cmi.core.lesson_status",
        STUDENT_NAME: "cmi.core.student_name",
        STUDENT_ID: "cmi.core.student_id",
        SESSION_TIME: "cmi.core.session_time",
        SUSPEND_DATA: "cmi.suspend_data",
        COMPLETED_VAL: "completed",
        NOT_ATTEMPTED_VAL: "not attempted",
        INCOMPLETE_VAL: "incomplete",
        INTERACTIONS_COUNT: "cmi.interactions._count",
        INTERACTIONS_ID: "cmi.interactions.n.id",
        INTERACTIONS_TYPE: "cmi.interactions.n.type",
        INTERACTIONS_COR_RESP: "cmi.interactions.n.correct_responses.0.pattern",
        INTERACTIONS_STU_RESP: "cmi.interactions.n.student_response",
        INTERACTIONS_RESULT: "cmi.interactions.n.result",
        INTERACTIONS_TIME: "cmi.interactions.n.time",
    },


    intervalNum: null,
    initialized: false,
	courseComplete: false,
    crsCompleteThisSession: false,
	allowMultiCompletions: true,
    suspendData: {},
    testCompletedSuccessfully: false,


    lmsInit: function() {

        try {

            var r = doLMSInitialize();
            lnx.util.log("LMSInitialize : " + r);
            if (r !== "true") {
                lnx.util.onError("Failed to initialize with LMS");
                return false;
            } else {
                this.initialized = true;

                this.lmsMaintainSession();

                var data = this.lmsGet(this.CMI.SUSPEND_DATA);
                
                this.suspendData = this.parseSuspendData(data);
				
				if (this.suspendData && this.suspendData.status === this.CMI.COMPLETED_VAL) {
                    this.courseComplete = true;
                }

                lnx.util.log("LMSInitialize suspend_data: " + data);

                // LRN mandated functionality 
                // Rely on susspend data value to test if course is 'really' completed	
                // call get for the purpose of logging current value
                // call set with value of incomplete as mandated by LRN to avoid duplicate completion records
                this.lmsGet(this.CMI.LESSON_STATUS);
                this.lmsSet(this.CMI.LESSON_STATUS, this.CMI.INCOMPLETE_VAL);
                return true;
            }

        } catch (e) {

            lnx.util.log("lmsInit error thrown: " + e);
            return false;
        }
    },


    lmsFinish: function() {

        try {
            if (this.intervalNum) {
                clearInterval(this.intervalNum);
            }

        } catch (e) {
            lnx.util.log("lmsFinish, clearInterval error: " + e);
        }


        try {
            // session time set in doLMSFinish


            // As mandatad by LRN docs
            if (this.crsCompleteThisSession) {
                this.lmsSet(this.CMI.LESSON_STATUS, this.CMI.COMPLETED_VAL);
            } else {
                this.lmsSet(this.CMI.LESSON_STATUS, this.CMI.INCOMPLETE_VAL);
            }

            this.uploadSuspendData(true, true);

            //this.lmsCommit(); // called in SCORM_12_APIWrapper.js as per LRN requirements
            var r = doLMSFinish();
            lnx.util.log("LMSFinish: " + r);
            if (r !== "true") {
                return false;
            } else {
                this.initialized = false;
                return true;
            }

        } catch (e) {

            lnx.util.log("lmsFinish error thrown: " + e);
            return false;
        }

    },    


    lmsCommit: function() {

        try {

            var r = doLMSCommit();
            lnx.util.log("LMSCommit: " + r);
            if (r !== "true") {
                return false;
            } else {
                return true;
            }

        } catch (e) {

            lnx.util.log("lmsCommit error thrown: " + e);
            return false;
        }
    },


    lmsGet: function( name ) {

        try {

            var r = doLMSGetValue(name);
            lnx.util.log("Get: " + name + " : " + r);
            return r;

        } catch (e) {

            lnx.util.log("lmsGet error thrown: " + e);
            return "";
        }
    },


    lmsSet: function( name, value, recordNum ) {

        try {
            if(recordNum !== undefined){
                name = name.replace(".n.", `.${recordNum}.`);
            }
            var r = doLMSSetValue(name, value);
            lnx.util.log("Set: " + name + " : " + value + " -- " + r);
            if (r !== "true") {
                return false;
            } else {
                return true;
            }

        } catch (e) {

            lnx.util.log("lmsSet error thrown: " + e);
            return false;
        }
    },


    lmsCompleteCourse: function( pass ) {

        try {

            // As per LRN docs, only set completion record if course not previously completed
            // we rely on value in suspend_data to determine if course has previoulsy been completed
            if (pass && ((!this.courseComplete) || this.allowMultiCompletions)) {
                this.crsCompleteThisSession = true;
                // this call could/should be defered to course exit as per LRN docs
                // leaving it in for present as back up in case of unconventional window exit/non exit	
                var r = this.lmsSet(this.CMI.LESSON_STATUS, this.CMI.COMPLETED_VAL);
                if (r) {
                    // LRN implementation is non-standard with regard to LMSCommit calls -
                    // not permited until course exit
                    // must assume data has/will be successfully persised
					this.courseComplete = true;
					
                    this.suspendData.status = this.CMI.COMPLETED_VAL;
                    this.uploadSuspendData(false,false,true);
                    //r = this.lmsCommit(); // added to account for LRN sync call failing when window closed directly 2) removed 1/9/21 at lrn request as temp fix
                    lnx.util.log("lmsCompleteCourse lmsCommit result: " + r);
                    // log whether this call has really 'stuck'
                    lnx.util.log("lmsCompleteCourse Get cmi.suspend_data --");
                    this.lmsGet(this.CMI.SUSPEND_DATA);
                    return true;
                } else {
                    if (lnx.config.ignoreLMS) {
                        return;
                    }
                    // must inform user that they may not actually get credit
                    lnx.util.onError("LMS failed to confirm Knowledge Check pass/course completion", true);
                }
            } else {
                lnx.util.log("lmsCompleteCourse test passed: " + pass);
                return true;
            }

        } catch (e) {

            lnx.util.log("lmsCompleteCourse error thrown: " + e);
            return;
        }
    },

    lmsCompleteSurvey: function(data, noExit){
        console.log(data);
        try{
            this.setSuspendDataValue("survey", data);
            this.uploadSuspendData();
        } catch(e){
            lnx.util.log("lmsCompleteSurvey error thrown: " + e);
        }
        
        if(noExit !== true){
            lnx.exit(true);
        }        
    },

    lmsLogTestResult: function(pass){
        this.testCompletedSuccessfully = pass;
    },

    getTestCompletedSuccessfully: function(){
        return this.testCompletedSuccessfully;
    },

    lmsMaintainSession: function() {

        var time = 1000 * 60 * 20;
        try {
            this.intervalNum = setInterval(lnx.scormApi.sessionKeeper, time);
        } catch (e) {
            lnx.util.log("lmsMaintainSession error: " + e);
        }
    },


    //IE does not pass args to setInterval so need this helper func
    sessionKeeper: function() {

        lnx.scormApi.uploadSuspendData();
        //lnx.scormApi.lmsGet(lnx.scormApi.CMI.STUDENT_ID);
    },


    parseSuspendData: function( data ) {

        try {
            var o = JSON.parse(data);
            return o;
        } catch (e) {

            lnx.util.onError(e, false, "parseSuspendData");
            return {};
        }
    },


    serializeSuspendData: function() {

        var s = JSON.stringify(this.suspendData);
        return s;
    },


    getSuspendData: function() {

        return this.suspendData;
    },

    
     uploadSuspendData: function(updateBookmark, setRestartBookmark, forceCommit){
            
        if(updateBookmark){
            if(setRestartBookmark){
                this.suspendData.bookmark = lnx.nav.getRestartNavId();
            } else {
                this.suspendData.bookmark = lnx.nav.getCurrNavId(true, this.crsCompleteThisSession);
            }            
        }        
        var data = this.serializeSuspendData();
        var r = this.lmsSet(this.CMI.SUSPEND_DATA, data);
        if(forceCommit){
            r = this.lmsCommit();
        }
        return r;
    },

    getSuspendDataValue: function( val ) {

        try {
            if (this.suspendData) {
                return this.suspendData[val];
            }
        } catch (e) {
            lnx.util.onError(e, false, "getSuspendDataValue: " + val);
        }
        return null;
    },


    setSuspendDataValue: function( prop, val ) {

        if (prop) {
            this.suspendData[prop] = val;
        }
        return this.suspendData;
    },
	
	
	getIsInitialized : function() {
		
		return this.initialized;
	},
	
	getIsCourseComplete: function(){
		
		return this.courseComplete;
	},
	
	setMultiCompletionsStatus: function(status){
		this.allowMultiCompletions = status;
	},

 //    updateLMSBookmark: function(){
 //        this.suspendData.bookmark = lnx.nav.getCurrNavId(false, this.crsCompleteThisSession);
 //        var data = this.serializeSuspendData();
 //        this.lmsSet(this.CMI.SUSPEND_DATA, data);
	// }

};


lnx.config = {

    isIpad: (/ipad/i).test(navigator.userAgent),

    isIE: (navigator.appName === "Microsoft Internet Explorer"),

    isIE8orLess: ((navigator.appName === "Microsoft Internet Explorer") &&
			(!document.createElement("video").canPlayType)),

    isIE6: false,
	
	isIELessThan8: false,

    useHTML5: true,

    showDebugWin: (/debug=true/i).test(top.window.location.search),

    debugWithCourseComplete: (/debugwithcoursecomplete=true/i).test(top.window.location.search.toLowerCase()),

    debugOutput: null,

    autoAudio: true,

    noAudio: true,

    isR2L: false,

    courseId: "",

    //UNDO set to false in release version
    showAlerts: false,
	
	//UNDO set to false in release version
    ignoreLMS: (/http\:\/\/localhost\/dev/i).test(top.window.location) || (/http\:\/\/(www\.)?learnex\./i).test(top.window.location) ||
				(/ignorelms=true/i).test(top.window.location.search.toLowerCase()),
    screenShotMode: (/mode=screenshot/i).test(top.window.location),

    overrideLinearNav: (/overrideLinearNav=true/i).test(top.window.location),

	winDim: {w: 1100, h: 924}, 

    showEdits: (/showEdits/i).test(top.window.location),

    editNumber: null,

    showScreen: null,

    fontMultiplier: 1,

    init: function() {

        var self = this;

        if(this.showEdits && (/editNumber/i).test(top.window.location.search)){
            this.editNumber = extractHTMLParam("editNumber");
        }

        if(this.ignoreLMS && this.screenShotMode){
            addScreenShotCss();
        }

        function extractHTMLParamValue(val){
            var regex = new RegExp(val, "i");
            var s = top.window.location.search.split("&");
            for(var i=0;i<s.length;i++){
                if(regex.test(s[i])){
                    s = s[i].split("=");
                    return s[1];
                }
            }
            return null;
        }

        function setShowScreenVal(){
            var t = extractHTMLParamValue("showScreen");
            if(t){
                t = t.toUpperCase();
                var reg = /\d{0,3}_?(C_[A-Za-z0-9]{1,3})/;
                var r = t.match(reg);
                if(r){
                    return r[1];
                } else {
                    reg = /\d{0,3}_?(toc_[A-Za-z0-9]{1,3})/;
                    r = t.match(reg);
                    if(r){
                        lnx.view.showToc();
                    }
                }
            }
            return null;
        }
         
        function addScreenShotCss(){            
            var elm = document.createElement("link");  
            elm.setAttribute("rel", "stylesheet"); 
            elm.setAttribute("href", "screenshots.css"); 
            elm.setAttribute("media", "all"); 
            document.head.appendChild(elm);
        }

        this.showScreen = setShowScreenVal();
        

        if (this.showDebugWin) {
            this.showAlerts = true;
        }

        //this.useHTML5 = !this.isIE;

        if (this.isIE) {
			var ver = this.msIeVersion();
            this.isIE6 = ( ver === 6);
			this.isIELessThan8 = (ver !== 0 && ver < 8);
        }

        try {
            // hide flash video player if not ie
            if (!this.isIE) {
                var elm = document.getElementById("flashWarehouse");
                if (elm) {
                    elm.className = "hide";
                }
            }
        } catch (e) {

        }

        // UNDO remove
        // this.showDebugWin = true;

        try {
            if(!this.showEdits){
                top.window.resizeTo(this.winDim.w, this.winDim.h);
            }            
        }
        catch (e) {
			// sometimes resizing lms frameset can generate a security access error 
			// call non-error throwing func after delay
            window.setTimeout( lnx.util.resizeWin, 2000 );
        }

        // seperate resize call from debug setup so we dont loose both with one error
        try {
            if (this.showDebugWin && !this.debugOutput) {

                this.debugOutput = document.getElementById("debugOutput");
                this.debugOutput.style.display = "block";
                lnx.util.log("Debug Session...");
            }
        } catch (e) {

            lnx.util.onError(e, false, "config.init - showDebugWin");
        }

        if(this.debugWithCourseComplete){
            lnx.scormApi.courseComplete = true;
        }

    },

    onResize: function(){		
        var html = document.getElementsByTagName("html")[0];		
        // our font size unit is 62px e.g if window is 620px wide, set size of html element's font to 10px (.625rem)
        // player is 58.125rem wide - we use 62 below to allow for L/R margins of roughly 3% each side
		var fontSize = (window.innerWidth / 62) / 16; 
		html.style.fontSize = fontSize + "rem";
        lnx.config.fontMultiplier = 1/fontSize;
        
	},

    getFontMultiplier: function(){
        return this.fontMultiplier;
    },

    // ms code - http://support.microsoft.com/kb/167820
    msIeVersion: function() {

        try {

            var ua = window.navigator.userAgent;
            var msie = ua.indexOf("MSIE ");

            if (msie > 0) {
                // If Internet Explorer, return major version number
                return parseInt(ua.substring(msie + 5, ua.indexOf(".", msie)));
            } else {
                // If another browser, return 0
                return 0;
            }

        } catch (e) {
            return 0;
        }
    }

};

// adapted from padilicious.com script
lnx.swipeEvent = {


	triggerElementID : null,
	fingerCount : 0,
	startX : 0,
	startY : 0,
	curX : 0,
	curY : 0,
	deltaX : 0,
	deltaY : 0,
	horzDiff : 0,
	vertDiff : 0,
	minLength : 100, 
	swipeLength : 0,
	swipeAngle : null,
	swipeDirection : null,
	
	
	init : function(){
		
		lnx.util.updateEventListener( document, "touchstart", this.touchStart );
		lnx.util.updateEventListener( document, "touchmove", this.touchMove );
		lnx.util.updateEventListener( document, "touchend", this.touchEnd );
	},
	
	
	touchStart : function( event, passedName ) {
		
		lnx.swipeEvent.fingerCount = event.touches.length;
		
		if ( lnx.swipeEvent.fingerCount == 1 ) {
			// get the coordinates of the touch
			lnx.swipeEvent.startX = event.touches[0].pageX;
			lnx.swipeEvent.startY = event.touches[0].pageY;
			// store the triggering element ID
			lnx.swipeEvent.triggerElementID = passedName;
		} else {
			// more than one finger touched so cancel
			lnx.swipeEvent.touchCancel(event);
		}
	},

	touchMove : function( event ) {

		//event.preventDefault();
		if ( event.touches.length == 1 ) {
			lnx.swipeEvent.curX = event.touches[0].pageX;
			lnx.swipeEvent.curY = event.touches[0].pageY;
		} else {
			lnx.swipeEvent.touchCancel(event);
		}
	},
	
	touchEnd : function( event ) {

		//event.preventDefault();
		// check to see if more than one finger was used and that there is an ending coordinate
		if ( lnx.swipeEvent.fingerCount == 1 && lnx.swipeEvent.curX != 0 ) {
			// use the Distance Formula to determine the length of the swipe
			lnx.swipeEvent.swipeLength = Math.round(Math.sqrt(Math.pow(lnx.swipeEvent.curX - lnx.swipeEvent.startX,2) + Math.pow(lnx.swipeEvent.curY - lnx.swipeEvent.startY,2)));
			// if the user swiped more than the minimum length, perform the appropriate action
			if ( lnx.swipeEvent.swipeLength >= lnx.swipeEvent.minLength ) {
				lnx.swipeEvent.caluculateAngle();
				lnx.swipeEvent.determineSwipeDirection();
				lnx.swipeEvent.processingRoutine();
				lnx.swipeEvent.touchCancel(event); // reset the variables
			} else {
				lnx.swipeEvent.touchCancel(event);
			}	
		} else {
			lnx.swipeEvent.touchCancel(event);
		}
	},

	touchCancel : function( event ) {

		// reset the variables back to default values
		lnx.swipeEvent.fingerCount = 0;
		lnx.swipeEvent.startX = 0;
		lnx.swipeEvent.startY = 0;
		lnx.swipeEvent.curX = 0;
		lnx.swipeEvent.curY = 0;
		lnx.swipeEvent.deltaX = 0;
		lnx.swipeEvent.deltaY = 0;
		lnx.swipeEvent.horzDiff = 0;
		lnx.swipeEvent.vertDiff = 0;
		lnx.swipeEvent.swipeLength = 0;
		lnx.swipeEvent.swipeAngle = null;
		lnx.swipeEvent.swipeDirection = null;
		lnx.swipeEvent.triggerElementID = null;
	},
	
	caluculateAngle : function() {
		
		var X = lnx.swipeEvent.startX-lnx.swipeEvent.curX;
		var Y = lnx.swipeEvent.curY-lnx.swipeEvent.startY;
		var Z = Math.round(Math.sqrt(Math.pow(X,2)+Math.pow(Y,2))); //the distance - rounded - in pixels
		var r = Math.atan2(Y,X); //angle in radians (Cartesian system)
		// get angle in degrees
		lnx.swipeEvent.swipeAngle = Math.round(r*180/Math.PI); 
		if ( lnx.swipeEvent.swipeAngle < 0 ) { lnx.swipeEvent.swipeAngle =  360 - Math.abs(lnx.swipeEvent.swipeAngle); }
	},
	
	determineSwipeDirection : function() {

		if ( (lnx.swipeEvent.swipeAngle <= 10) && (lnx.swipeEvent.swipeAngle >= 0) ) {
			lnx.swipeEvent.swipeDirection = "left";
		} else if ( (lnx.swipeEvent.swipeAngle <= 360) && (lnx.swipeEvent.swipeAngle >= 350) ) {
			lnx.swipeEvent.swipeDirection = "left";
		} else if ( (lnx.swipeEvent.swipeAngle >= 170) && (lnx.swipeEvent.swipeAngle <= 190) ) {
			lnx.swipeEvent.swipeDirection = "right";
		} else if ( (lnx.swipeEvent.swipeAngle > 10) && (lnx.swipeEvent.swipeAngle < 170) ) {
			lnx.swipeEvent.swipeDirection = "down";
		} else {
			lnx.swipeEvent.swipeDirection = "up";
		}
	},
	
	processingRoutine : function() {
		
		//var swipedElement = document.getElementById("screenFrame");
		var swipedElement = document.body;
		if ( lnx.swipeEvent.swipeDirection === "left" ) {
			
			lnx.nav.next();
		} else if ( lnx.swipeEvent.swipeDirection === "right" ) {

			lnx.nav.previous();
		}
	}
			
};


lnx.util = {

		
	stringer : null,
	
	xmlObj : null,
    xmlDocs: [],

	
	init : function(file){
        if(!file) file = "./course.xml?nocache=";
		this.getXML(file + (new Date).getTime(), this.onXMLLoad.bind(this));
	},
	
	processFile: function(xml){
        this.xmlDocs.push(xml);
        if(lnx.config.showEdits && this.xmlDocs.length < 2){
            this.getXML("./edits.xml?nocache=" + (new Date).getTime(), this.onXMLLoad.bind(this));
        } else {            
            lnx.localization.init( this.xmlDocs[0] );
            lnx.nav.init( this.xmlDocs[0] );
            if(lnx.config.showEdits) lnx.edits.init( this.xmlDocs[0], this.xmlDocs[1] );
        }
    },
	
	getXML : function( url, f ){	

		try{

			var x = this.xmlObj = this.getRequestObject();
			x.onreadystatechange = f;
			x.open("GET", url);
			x.send();
			
		} catch( e ){
			
			lnx.util.onError(e, true, "getXML");
		}
	},
	
	
	getRequestObject : function(){
		
		if( window.XMLHttpRequest ){
			return new XMLHttpRequest();
		}
		
		try {
			
			return new ActiveXObject("MSXML2.XMLHTTP.6.0");
			
		} catch( e ){

			try {
				
				return new ActiveXObject("MSXML2.XMLHTTP.3.0");
				
			} catch( e2 ){
				
				throw new Error("XMLHTTP not supported");
			}
		}
	},
	
	
	onXMLLoad : function(){
		
		// in ie8 where enable native XMLHTTP support is disabled
		// we have to revert to activeX obj
		// in this case this != the request obj in callback func
		// hence we use prop ref - lnx.util.xmlObj
		if( lnx.util.xmlObj.readyState == 4 ){
			if( lnx.util.xmlObj.status == 200 ){
				var xml = lnx.util.xmlObj.responseXML;
				if( !xml || (xml && (xml.parseError && (xml.parseError.errorCode !== 0)))){
					lnx.util.onError("Network error\nPlease restart course", true);	
				} else {
					// no nomalize in ie for XML docs
					if( xml.normalize ){
						xml.normalize();
					}
					lnx.util.stripWhiteSpace( xml );
                    this.processFile(xml);
				}
			} else {
				lnx.util.onError("Network error, status: " + lnx.util.xmlObj.status + "\nPlease restart course", true);
			}
		}
	},
	
	
	XMLToString : function( node ){
		
		if ( node.xml ) {
			return node.xml;
		}
		
		this.stringer || ( this.stringer = new XMLSerializer() );
		return this.stringer.serializeToString( node );
	},
	 
	 
	// IE property preserveWhiteSpace defaults to false 
	// 'whitespace' text nodes are therefore ignored when walking doc tree.
	// In IE, therefore, stripWhiteSpace never gets a chance to remove same. 
	// If u inspect serialized doc after processing, whitespace 
	// formatting remains in IE (as its not considered a node - c above) 
	// but not in safari, firefox etc
	// unknown/lost url for attribution of this function
	stripWhiteSpace : function( n ){
		
		for(var i = 0; i < n.childNodes.length; i++){
			var c = n.childNodes[i];
    		if(c.nodeType == 3 && !(/\S/.test(c.nodeValue))){
				n.removeChild(c);
      			i--;
   			}
   			if(c.nodeType == 1){
      			this.stripWhiteSpace(c);
    		}
 		}
 		return n;
	},
	
	
	getElmsByTagAndAttrib : function( elm, tag, attrib ){
		
		var res = [];
		var elms = elm.getElementsByTagName( tag );
		if( elms.length ){
			var l = elms.length;
			for( var i = 0; i < l; i++ ){
				if( elms[i].getAttribute(attrib) ){
					res.push( elms[i] );
				}
			}
		}
		return res;
	},


	onWinErr : function( msg, url, line ){
		
		this.onError(msg + ", " +  url + ", " + line);
		return false;
	},
	
	
	onError : function( e, force, info ){
		
		var nl	= "\n";
		var msg = "Error details:" + nl;
		
		if( !info ){
			info = "";
		}
		
		if( typeof e === "object" ){
			msg		+=  "name: "		+	e.name				+ nl;
			msg		+=	"message: "		+	e.message			+ nl;
			msg		+=	"description: "	+	e.description		+ nl;
			msg		+=	"number: "		+	(e.number & 0xffff)	+ nl;
			msg 	+= info;
		} else {
			msg = "Error: " + e + nl + info;
		}
		this.log( msg );
		if (!force && !lnx.config.showAlerts) { //(!( force || lnx.config.showAlerts ))
			return;
		}
		// need to cater for iPad
		alert( msg );
		//UNDO remove
		//debugger;
	},
	
	
	log : function( msg ){
	
		try{
			if( window.console ){
				window.console.log(msg);
			}
			
			if( lnx.config.showDebugWin ){
				lnx.config.debugOutput.insertAdjacentText("beforeEnd", (msg +"\n\n"));
				lnx.config.debugOutput.doScroll("down");
			}
		
		} catch( e ){
			
		}
			
	},


	// adds or removes event listeners 
	// caters for ie legacy event model
	updateEventListener : function( evtTargs, type, listener, remove ){
		
		var temp, elm, method;
		
		// allow method to be called with single or multiple targets
		if ( evtTargs.constructor !== Array ) {
			evtTargs = [evtTargs];
		}
		
		// determine if we are adding or removing listeners and handle ie 8
		if( document.addEventListener ){
			method = remove ? "removeEventListener" : "addEventListener";
		} else {
			method = remove ? "detachEvent" : "attachEvent";
			type = "on" + type;
		}
				
		// note assumption - currently not testing validity of 'non-string' elms
		for( var i = 0, len =  evtTargs.length; i < len; i++ ){
			elm = evtTargs[i];
			if( typeof elm === "string" ) {
				elm = temp = document.getElementById(elm);
				if(!elm){
					lnx.util.onError(
						"Failed to find element in updateEventListener, " + temp
					);
					continue;
				}
			}
			// update listener
			elm[method](type, listener, false);
		}		
	},
	
	
	resizeWin: function(){
		
		try {

            top.window.resizeTo(lnx.config.winDim.w, lnx.config.winDim.h);
        }
        catch (e) {

            lnx.util.onError(e, false, "util.resizeWin - resizeTo");
        }
		
	},
	
    stopVOverflow: function(d){     
        if(!d)          {
            console.log("ERROR: No element passed to stopVOverflow");
            return;
        }
        if(d.scrollHeight > d.clientHeight){
            var sz = parseFloat(getComputedStyle(d).fontSize);
            //convert to rem
            sz /= 16;
            while(sz > 0.6875){ 
                sz -= 0.0625;
                d.style.fontSize = (sz + "rem");
                if(d.scrollHeight <= d.clientHeight){
                    break;
                }
            }
        }
    },
	
    stopHOverflow: function(d){
        var lh = parseFloat(getComputedStyle(d).lineHeight);
        var i = 1;
        var fs = parseFloat(getComputedStyle(d).fontSize);
        while (parseInt(getComputedStyle(d).height) > lh) {
            d.style.fontSize = (fs - i++) + "px";
            if (i > 100) {
                break;
            }
        }
    },
	
	destroy: function(){
		
		this.stringer = null;
		this.xmlObj = null;
	}
	
};

lnx.edits = {

    editViewer: null,
    editList: null,
    edits: null,
    divs: [],
    screenInfo: [],
    available: false,
    curListItem: null,
    listItems: null,
    course: null,

    init: function(course, edits){

        this.available = true;
        this.course = course;
        //addEditKey(document.getElementById("innerContainer"));
        this.editViewer = document.getElementById("innerContainer")
            .appendChild(document.createElement("div"));
        this.editViewer.id = "editViewer";
        this.editList = document.body.appendChild(document.createElement("div"));
        this.editList.id = "editList";
        this.editList.addEventListener("click", this.onListSelect.bind(this));     
        this.editList.style.display = "block";       

        var fb = course.querySelectorAll("[class='feedback']");
        for(var i=0;i<fb.length;i++){
            //fb[i].classList.add("showFeedback");
            fb[i].setAttribute("class", fb[i].getAttribute("class") + " showFeedback");
        }

        var s = "";
        s += "<div><p>Info: </p><div></div></div>";
        s += "<div><p>Old Version</p><div></div></div>";
        s += "<div><p>Abbott Edit</p><div></div></div>";
        s += "<div><p>New Version</p><div></div></div>";
        s += "<div><p>English</p><div></div></div>";
        this.editViewer.innerHTML = s;
        for(var i=0;i<5;i++){
            this.divs.push(this.editViewer.childNodes[i].childNodes[1]);
        }

        var list = [],
            self = this;
        this.edits = edits.documentElement.childNodes;
        //this.edits.forEach(processEdit); //forEach doesn't work for nodeLists in IE
        for(var i=0;i<this.edits.length;i++){
            processEdit(this.edits[i]);
        }

        lnx.nav.getOrderedScreenList(list);
        addMappingToEdit(list, this.edits);
        addToEditList(list, this.edits);

        if(lnx.config.editNumber){
            var e = this.editList.querySelector('tr[number="' + lnx.config.editNumber + '"');
            if(e){
                e = {target: e};
                this.onListSelect(e);
            }            
        }

        var p = this.editList.appendChild(document.createElement("p"));
        p.innerHTML = '<a href="../../reports/allLangs.html?lang=' + edits.documentElement.getAttribute("langId") + '" target="blank">Edits Report, this languages</a>';
        p = this.editList.appendChild(document.createElement("p"));
        p.innerHTML = '<a href="../../reports/allLangs.html" target="blank">Edits Report, all languages</a>';

        function processEdit(edit){
            var cp = edit.getAttribute("csspath"),
                xp = edit.getAttribute("xpath"),
                type = edit.getAttribute("type"),
                rows = edit.getAttribute("rows"),
                match = edit.getAttribute("match"),
                number = edit.getAttribute("number"),
                node = course.querySelector(cp);

            if(!node){
                // IE has problem with passing XML ids to QS
                var r = cp.match(/#\S+/g);
                for(var i=0;i<r.length;i++){
                    r[i] = r[i].replace(/">$/, "");  
                    cp = cp.replace(r[i], "[id='"+ r[i].substring(1) + "']");
                }
            }
            node = course.querySelector(cp);
           
            if(type === "deletion"){
                var elm = course.createElement("span");
                if(navigator.vendor){
                    elm.innerHTML = "&#x20;&#x20;[DEL]";
                } else {
                    elm.appendChild(course.createTextNode("_[DEL]_"));
                }                
                node.appendChild(elm);                
                node = elm;
            }

            if(!node.classList){
                var pre = node.getAttribute("class") ? node.getAttribute("class") + " " : "";
                node.setAttribute("class", pre + "edit_" + type);
            } else {
                node.classList.add("edit_" + type);
            }
            
            node.setAttribute("number", number);
            node.setAttribute("onclick", "lnx.edits.onSelect(" + number + ")");

            var id = xp && xp.match(/\[@id='(.+?)']/)[1];
            if(!id){
                id = cp.match(/\[id='(.+?)']/)[1];
            }
            edit.setAttribute("screen", id);
            list.push({id: id, rows: rows, match: match, number: number, edit: edit});
        }

        function addMappingToEdit(list, edits){
            for(var i=0;i<list.length;i++){
                list[i].edit.setAttribute("orderNumber", i+1);
            }
        }

        function addToEditList(list, edits){            
            this.editList.innerHTML = createTable(list, edits);
            //this.editList.childNodes[1].insertAdjacentHTML("beforeEnd", ("<li sid='" + list[i].id + "'>" + content + "</li>"));            
        }

        function createTable(list, edits){
            var space = "&nbsp;&nbsp;",
                sp2 = space + space + space + space,
                s = "<table><thead><tr><th colspan='4'><div class='editKey'>Edit key: &nbsp;&nbsp;&nbsp;&nbsp;<div>&#x00A0;</div><span>Revised</span><div>&#x00A0;</div><span>New</span><div>&#x00A0;</div><span>Deleted</span></div></th></tr><tr><th>Edit #</th><th>Screen #</th><th>Row #</th><th>&nbsp;&nbsp;Match</th></tr></thead><tbody>";
            for(var i=0;i<list.length;i++){
                var match = list[i].match === "true" ? "&#x2714;" : (list[i].match === "" ? "" : "&#x2716;");
                var num = ((i<9)?"&nbsp;":"") + (i+1);
                var idx = list[i].idx;
                idx = (idx < 10) ? space+idx : idx;
                s += "<tr " + "sid='" + list[i].id + "' number='" + list[i].number + "' orderNumber='" + (i+1) + "'><td>" + num + "</td><td>" + idx + space +  "(" + list[i].hIdx + ")</td><td>" + sp2 + list[i].rows.replace(/,/g, ", ") + "</td><td>" + match + "</td></tr>";
            }       
            s+= "</tbody></table>";
            return s;
        }

        function addEditKey(elm){
            var html = "<div class='editKey'><div></div><span>Revised Content</span><div></div><span>New Content</span><div></div><span>Deleted Content</span></div>"
            elm.insertAdjacentHTML("beforeEnd", html);
        }
    },

    handleKey: function (k){
        if(!this.available) return;
        var items = this.editList.querySelectorAll("tbody tr"),
            i = 1;
        if(k === "ArrowDown"){            
            if(this.curListItem){
                if(this.curListItem.nextSibling){
                    i = parseInt(this.curListItem.getAttribute("orderNumber"));
                    i++;
                }
                this.onListSelect(null, i, true);            
            } else {
                this.findNextPrevScreenWithEdit()
            }
        } else if(k === "ArrowUp"){
            if(this.curListItem){
                if(this.curListItem.previousSibling){
                    i = parseInt(this.curListItem.getAttribute("orderNumber"));
                    i--;
                } else {
                    i = items.length;
                }
                this.onListSelect(null, i, true);
            } else {
                this.findNextPrevScreenWithEdit(true);
            }            
        }
    },

    findNextPrevScreenWithEdit: function(prev){
        var navId = lnx.nav.getNextPrevNavIds(prev);
        if(!navId){
            navId = this.getFisrtLastEditNavId(prev);
        }
        if(lnx.nav.getCurrNavId() !== navId){
            lnx.nav.navigate(navId, false);
            if(prev){
                // need to jump to last edit if more than one
                var sid = this.curListItem.getAttribute("sid")
                var nextSib = this.curListItem.nextSibling;                
                while(nextSib){
                    if(!(sid == nextSib.getAttribute("sid"))){
                        break;
                    } else {
                        this.updateList(nextSib);
                        this.onSelect(nextSib.getAttribute("number"));
                        nextSib = nextSib.nextSibling;
                    }
                }
            }
        } 
    },

    getFisrtLastEditNavId: function(last){
        var items = this.editList.querySelectorAll("tbody tr");
        var item = last ? items[items.length-1] : items[0];
        return item.getAttribute("sid");
    },

    setUp: function(){
        if(this.available) this.onSelect();
    },

    tearDown: function(){
        if(this.available){
            this.editViewer.style.display = "none";
        }
    },

    onListSelect: function(e, i, viaKey){
        var targ, navId, number;
        if(e){
            navId = e.target.getAttribute("sid") || e.target.parentNode.getAttribute("sid");
            if(!navId) return; 
            targ = e.target.hasAttribute("sid") ? e.target : e.target.parentNode;
        }     
        this.updateList(targ, i);
        if(navId || viaKey){
            navId = navId ? navId : this.curListItem.getAttribute("sid");
            number = this.curListItem.getAttribute("number");
            if(lnx.nav.getCurrNavId() !== navId) lnx.nav.navigate(navId, true);
            this.onSelect(number, true);
        }
    },

    updateList: function(cur, i, clear){
        var prevListItem = this.curListItem;
        if(clear){
            if(prevListItem) prevListItem.style.outline = "";
            this.curListItem = null;
            return;
        }
        if(!cur){
            this.curListItem = this.editList.querySelectorAll("tbody tr")[i-1];
        } else {
            this.curListItem = cur;
        }
        if(prevListItem) prevListItem.style.outline = "";
        this.curListItem.style.outline = "1px solid black";
    },

    onSelect: function(num, viaList){
        var self = lnx.edits,
            v = self.editViewer,
            e = self.edits,
            d = self.divs,
            s = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;",
            match, edit, elms;
        
        elms = document.getElementById("screenFrame").querySelectorAll("fieldset.show [number]");
        if(!elms.length){
            // not a question screen, make more general check
            elms = document.getElementById("screenFrame").querySelectorAll("[number]");
        }
        if(!elms.length){
            this.updateList(null, null, true);
            return;
        }
        if(!num){
            num = parseInt(elms[0].getAttribute("number"));
        }
        for(var i=0;i<elms.length;i++){
            if(elms[i].getAttribute("number") === num.toString()){
                elms[i].style.outline = "1px solid black";
            } else {
                elms[i].style.outline = "";
            }
        }        

        v.style.display = "block";
        edit = e[num-1];
        match = edit.getAttribute("match");
        match = match === "true" ? "&#x2714;" : (match === "" ? "" : "&#x2716;"),
        d[0].innerHTML = "Edit #: " + edit.getAttribute("orderNumber") + s + "Type: " + edit.getAttribute("type") + s + "Match: " +  match + s + "Row(s): " + edit.getAttribute("rows");
        d[1].innerHTML = edit.childNodes[0].textContent;
        d[2].innerHTML = edit.childNodes[2].textContent;
        d[3].innerHTML = edit.childNodes[1].textContent;
        d[4].innerHTML = edit.childNodes[3].textContent;

        if(!viaList){
            self.onListSelect.call(this, null, parseInt(edit.getAttribute("orderNumber")));
        }
    }
};

lnx.localization = {
	
	stringMap : {},
	
	
	init : function( doc ){
		
		var s = doc.getElementsByTagName("strings")[0];
		
		for( var i = 0, len = s.childNodes.length; i < len; i++ ){
			
			if( s.childNodes[i].nodeType === 1 ){
				this.stringMap[s.childNodes[i].tagName] = s.childNodes[i].firstChild.nodeValue;
			}
		}
	},
	
	
	getLocalString : function( id ){
		
		return this.stringMap[id];
	}
	
};


// this object provides an interface for messages from 
// embedded flash swf files
lnx.flashInterface = {
		
	flashVideoIsReady : false,
	
	
	// invoked by flash player when it starts to plays a video
	playing : function( id ){
		
		lnx.util.log("flashplaying");
		lnx.audio.stopAudio();
	},
	
	// invoked by initial host swf when it loads
	ready : function(){
		
		this.flashVideoIsReady = true;
	},
	
	// log error messages from swfs
	onError : function( e ){
		
		lnx.util.onError( e, false, "via flashInterface" );
	}
	
};




lnx.nav = {

    // nav target on test retake
    TEST_RETAKE_ID: "Q_1", //"C_32",

    // shortcut refs
    content: null,
    toc: null,
    screens: null,

    //xml node containers
    navNodes: [], // list of leaf navigation nodes, keys added to also allow accesse as a map
    navNodeMap: {}, // map of all navigation nodes inc branch nodes
    screensMap: {}, // map of all content screens
    templateMap: {},
	allNodes: [], // list of all nodes inc. branch nodes - used for forced linear navigation feature

    navIndex: 0,
    currNavId: "",

    // indicate when app is at first or last screen
    terminals: {

        isFirst: false,
        isLast: false
    },
	
	farIndex: 0,
	farNavId: null,
	isLinearNav: false,
    completeAllScreens: false,
	isAutoCompletion: false,
    keys: {
        "ArrowDown"  : "ArrowDown",
        "Down"       : "ArrowDown",
        "ArrowUp"    : "ArrowUp",
        "Up"         : "ArrowUp",
        "ArrowRight" : "ArrowRight",
        "Right"      : "ArrowRight",
        "ArrowLeft"  : "ArrowLeft",
        "Left"       : "ArrowLeft"
    },

    tocPanel: null,
    currNodeType: null,
    mustCompleteMap: {
    	"hasVirtualScreenOverlay": true,
        "scenarioWithVirtualScreens": true,  
        "dialogueWithVirtualScreens": true,      
        "verticalScenario": true,
        "dialogue": true,
        "stages": true,
        "flashCard": true,
        "selectRevealEmail": true, 
        "infoGraphicVirtualScreens1": true,
        "infoGraphicVirtualScreens2": true,
        "flowChartAnimation": true,
        "emailAnim1": true,
        "emailAnim2": true,
        "blurBoxQuestion": true,
        "verticalParallax": true,
        "quickCheck": true,
        "animVer": true,
        "clickAndAnimateText": true,
        "sliderIcons": true
    },
    screenLocked: false,
    currNode: null,
    isFrameWork2: false,
    helpRefIds: null,
    audioTout: null,
    jumpTo: null,
    homeId: null,

    init: function( doc ) { 
		
		// let user exit course if we have not got scorm api ref
		if (!lnx.config.ignoreLMS && !lnx.scormApi.getIsInitialized()) {
            var prompMsg = lnx.localization.getLocalString("s1");
            if (!window.confirm(prompMsg)) {
                top.window.close();
                return;
            }
        }
		
        // if ipad add swipe event handling
        if (lnx.config.isIpad) {
            lnx.swipeEvent.init();
        }

        this.content = doc;
		var cr = doc.getElementsByTagName("course")[0];

        this.jumpTo = cr.getAttribute("jumpto");

        var t = parseInt(cr.getAttribute("audiotout"));
        this.audioTout = isNaN(t) ? null : t * 1000;

        this.isFrameWork2 = cr.getAttribute("framework") === "2";
        this.frameWorkNum = cr.getAttribute("framework");
        if(this.isFrameWork2){
            this.helpRefIds = [];
            this.helpRefIds.push(cr.getAttribute("helpId"));
        }
		this.isLinearNav = cr.getAttribute("linearnav") === "true" && 
			!lnx.scormApi.getIsCourseComplete() && (!lnx.config.showEdits);

        if(lnx.config.overrideLinearNav){
            this.isLinearNav = false;
        }
        if(this.isLinearNav){
            this.completeAllScreens = cr.getAttribute("completeallscreens") === "true"  && !lnx.config.screenShotMode;
        }
		this.isAutoCompletion = cr.getAttribute("autocompletion") === "true" && 
			!lnx.scormApi.getIsCourseComplete();
        this.alwayshowRef = cr.getAttribute("alwayshowRef");
		lnx.scormApi.setMultiCompletionsStatus(!(cr.getAttribute("allowmulticompletions") === "false"));
        lnx.config.noAudio = (!(cr.getAttribute("noaudio") === "false"));
        lnx.config.isR2L = (cr.getAttribute("isR2L") === "true");        
        lnx.config.courseId = cr.getAttribute("id");
        this.toc = doc.getElementsByTagName("toc")[0];
        this.screens = doc.getElementsByTagName("screens")[0];
        this.homeId = cr.getAttribute("homeId");
        //this.createTemplateMap(doc.getElementsByTagName("templates")[0]);
        this.parseToc(this.toc);
        this.createScreensMap(this.screens);
        this.assignHandlers();
        var hideAudio = lnx.config.noAudio;
        document.addEventListener("keyup", this.onKeyUp.bind(this));

        this.getStartNavId(); // ensure farIndex set before calling view init

        lnx.view.init(this.toc.childNodes, this.onNavigate, lnx.audio.getAudioOn(), hideAudio, this.isFrameWork2); 

        if(this.alwayshowRef){
            var n = this.navNodeMap[this.alwayshowRef];
            var n = this.screens.querySelector(`#${this.alwayshowRef}`);
            var n2 = this.screens.querySelector("#C_300");
            //var gp = n.parentNode.parentNode;
            var title = "Resources"; //gp.getAttribute("title");
            refGPnavId = this.alwayshowRef;
            lnx.view.refPanel.init(n, this.screensMap, title, refGPnavId);
            //lnx.view.glossPanel.init(n2, this.screensMap, "Glossary", "C_300");
        }       

        this.tocPanel.init(this.toc);

        lnx.progBar.init();

        // display first screen
        this.navigate(this.getStartNavId());
    },

    getIsCompleteAllScreens: function(){
        return this.completeAllScreens;
    },

    onKeyUp: function(e){
        var self = this,
            key = normalizeKey(e.key);
        if(key === "ArrowUp" && e.shiftKey && e.altKey && this.jumpTo){
            if(this.jumpToScreen(this.jumpTo)){
                return;
            }            
        }
        if(key === "ArrowDown" || key === "ArrowUp"){ 
            lnx.edits.handleKey.call(lnx.edits, key);
        } else if(key === "ArrowRight"){
            this.next();
        } else if(key === "ArrowLeft"){
            this.previous(e.shiftKey);
        }

        function normalizeKey(k){
            return self.keys[k];
        }
    },

    jumpToScreen: function(screen){
        if(this.navNodeMap[screen]){
            var navId = screen;
            this.farIndex = this.navNodes[navId];
            this.farNavId = navId;
            this.navigate(navId);
            return true;
        }
        return false;
    },

    getStartNavId: function() {

        var navId = null;

        // grab potential bookmark
        var data = lnx.scormApi.getSuspendData();
        // first check is their a navid in the url querystring
        if(lnx.config.showScreen && this.navNodeMap[lnx.config.showScreen]){
            navId = lnx.config.showScreen;
            this.farIndex = this.navNodes[navId];
        } else if(data && data.bookmark && this.navNodeMap[data.bookmark]) {
            navId = data.bookmark;
			this.farIndex = this.navNodes[navId];
        } else {
            // no bookmark so return navId of first toc node
            navId = this.navNodes[0].getAttribute("navId");			
		}
		this.farNavId = navId;
        return navId;
    },

    getHasSurvey: function(){
        var r = 0;
        if(this.navNodes[this.navNodes.length - 1].getAttribute("type") === "survey"){
            r = 1;
            if(!lnx.scormApi.getSuspendDataValue("survey")){
                r = -1;
            }
        }
        return r;
    },

    getRestartNavId: function(){

        var fi = this.farIndex;
        var hasSurvey = this.getHasSurvey();
        var surveyComplete = hasSurvey === 1;
        var courseComplete = lnx.scormApi.getIsCourseComplete();
        var last = this.navNodes.length - 1;
        var secLast = last - 1;
        var thirdLast = last - 2;
        var fourthLast = last - 3;
        var first = 0;
       
        if(this.farIndex === last){
            if(!hasSurvey){
                if(courseComplete){
                    fi = first;
                } else {
                    fi = thirdLast;
                }
            } else {
                if(!surveyComplete){
                    fi = last;
                } else {
                    fi = first;
                }
            }
        } else if(this.farIndex === secLast && hasSurvey){
            if(courseComplete && surveyComplete){
                fi = first;
            } else if(courseComplete && !surveyComplete){
                fi = last;
            } else {
                fi = fourthLast;
            }
        }
        return this.navNodes[fi].getAttribute("navId");            
    },

    getCurrNavId: function( notLast, setFirst ) {

        try {

            var result = "";
            if (!this.currNavId) {
                return this.navNodes[0].getAttribute("navId");
            }

            result = this.currNavId;

            // notLast can be specified - for bookmarking purposes 
            // so we do not return user to test feedback screen 
            // check if currNavId is last screen and return id for first screen if this is the case
            if (this.currNavId && notLast) {
                if (this.navNodes[this.currNavId] === (this.navNodes.length - 1)) {
                    result = this.navNodes[0].getAttribute("navId");
                }
            }
			
			// if setFirst is true reset bookmark to first screen
			if (setFirst){
				result = this.navNodes[0].getAttribute("navId");
			}
			
            return result;
			
        } catch (e) {

            lnx.util.onError(e, false, "getCurrNavId");
            return "";
        }
    },

    getNextPrevNavIds: function(prev){
        var n = this.navNodes,
            id = this.currNavId, 
            idx = this.navNodes[id], tId;

        while(idx > -1 && idx < n.length){
            id = n[idx].getAttribute("navId");
            tId = n[idx].getAttribute("targetId");
            if(!this.screensMap[id]){
                // must be a virtual question screen
                if(tId && (this.screensMap[tId].querySelector("[number]") || this.screensMap[tId].getAttribute("number"))){
                    return id;
                }                
            } else if(this.screensMap[id].querySelector("[number]") || this.screensMap[id].getAttribute("number")){
                return id;
            }
            idx = prev ? (idx-1) : (idx+1);
        }
    },

    getOrderedScreenList: function(list){
        //var a = [], b = [];
        for(var i=0;i<list.length;i++){
            list[i].idx = this.navNodes[list[i].id] + 1;
            list[i].hIdx = getHidx(this.navNodes[list[i].idx-1]);
           // a.push(list[i].number);
        }
        list.sort(order);
        // for(var i=0;i<list.length;i++){           
        //     console.log(a[i], " : ", list[i].number, list[i].id);
        // }
        return list;

        function getHidx(n){
            var p = n.parentNode,
                r = [];
            while(p){
                r.unshift(getPosInList(p.childNodes, n));
                n = p;
                p = n.tagName.toLowerCase() === "nav" ? p.parentNode : null;
            }
            return r.join(".");

            function getPosInList(cn, n){
                for(var i=0;i<cn.length;i++){
                    if(cn[i] === n){
                        return i+1;
                    }
                }
            }
        }

        function order(a, b){
            if(a.id === b.id){
                // var c = a.rows ? a.rows.split(",")[0] : 0,
                //     d = b.rows ? b.rows.split(",")[0] : 0;
                // return c - d;
                return a.number - b.number;
            }
            return a.idx - b.idx;
        }
    },

    getCurrentProgressData: function(){
        var f = this.farIndex;
        var d = {};
        d.overallPc = 100 / this.navNodes.length * (f+1);
        d.topicPc = [];
        var m = this.toc.childNodes;
        var tl = 0;
        for(var i=0;i<m.length;i++){
            var p;
            //d[`${i+1}`] = m[i].querySelectorAll("nav > nav")
            var t = m[i].querySelectorAll("nav > nav > nav").length;
            tl+=t;
            if((tl - 1) < f){
                p = 100;
            } else if((tl-t-1) <= f ){
                p = 100 / t * (f + 1 - (tl - t));
            } else {
                p  = 0;
            }
            d.topicPc.push(p);
        }
        return d;
    },

    getTocIndexOfType: function(type, node){
        var index;
        var t = this.toc.querySelectorAll(`nav[type='${type}']`);
        for(var i=0;i<t.length;i++){
            if(t[i] === node){
                index = i;
                break;
            }
        }
        return index;
    },

    parseToc: function( n ) {

        for (var i = 0, len = n.childNodes.length, navId; i < len; i++) {

            if (n.childNodes[i].nodeType !== 1) {
                continue;
            }

            navId = n.childNodes[i].getAttribute("navId");

            // map all navigatable nodes including non-leaves
            this.navNodeMap[navId] = n.childNodes[i];
			// property added for forced linear navigation feature
			// TO DO refactor various node maps/lists
			this.allNodes.push(n.childNodes[i]);
			// use navId as a hash for quick lookup of a nodes index
			this.allNodes[navId] = this.allNodes.length - 1;
            if (n.childNodes[i].hasChildNodes()) {
                this.parseToc(n.childNodes[i]);
            } else {
                // list of leaf navigatable nodes only
                // these nodes ultimately map to screens
                this.navNodes.push(n.childNodes[i]);
                // use navId as a hash for quick lookup of a nodes index
                this.navNodes[navId] = this.navNodes.length - 1;
            }

        }
    },

    getModuleNavIds: function(){
        var r = [];
        var a = Array.from(this.toc.childNodes);
        a.forEach((v)=>{r.push(v.getAttribute("navId"))});
        return r;
    },


    createScreensMap: function( n ) {

        for (var i = 0, len = n.childNodes.length; i < len; i++) {

            if (n.childNodes[i].nodeType === 1) {
                this.screensMap[n.childNodes[i].getAttribute("id")] = n.childNodes[i];
            }
        }
    },


    createTemplateMap: function( n ) {

        for (var i = 0, len = n.childNodes.length; i < len; i++) {

            if (n.childNodes[i].nodeType === 1) {
                this.templateMap[n.childNodes[i].nodeName] = n.childNodes[i].firstChild;
            }
        }
    },


    assignHandlers: function() {

        var exitBtn = document.getElementById("exitBtn");
        lnx.util.updateEventListener(exitBtn, "click", this.onExitCourse);

        var audioBtn = document.getElementById("audioBtn");
        lnx.util.updateEventListener(audioBtn, "click", this.onAudioUpdate);

        // catch pagehide events so we can kill any current audio
        lnx.util.updateEventListener(window, "pagehide", this.onPageHide);

        if(this.alwayshowRef && this.helpRefIds){
            var helpBtn = document.getElementById("helpBtn");
            helpBtn.setAttribute("data-navId", "resources");
            lnx.util.updateEventListener(helpBtn, "click", function(){lnx.view.refPanel.show();});
            var glossBtn = document.getElementById("glossBtn");
            if(glossBtn){
                glossBtn.setAttribute("data-navId", "glossary");
                lnx.util.updateEventListener(glossBtn, "click", function(){lnx.view.glossPanel.show();});
            }
            
        }
    },

    onPageHide: function( e ) {

        lnx.audio.stopAudio();
    },


    onExitCourse: function( e ) {

        // top.window.close()?
        lnx.exit(true);

        e = e || window.event;
        e.stopPropagation ?
		    e.stopPropagation() : (e.cancelBubble = true);
    },


    onAudioUpdate: function( e ) {

        if(lnx.nav.completeAllScreens && lnx.nav.getIsScreenLocked()){
            return;
        }
        e = e || window.event;
        var target = e.target || e.srcElement;

        var isOn = lnx.audio.getAudioOn();
        isOn = !isOn;
        lnx.audio.setAudioOn(isOn);
        if (!isOn) {
            lnx.audio.stopAudio();
        }
        lnx.view.updateAudioIcon(target, isOn);

        e.stopPropagation ?
		e.stopPropagation() : (e.cancelBubble = true);
    },


    onNavigate: function( e ) {

        // if(typeof e === "string"){
        //     lnx.nav.navigate(e);
        //     return;
        // }

        e = e || window.event;
        var target = e.target || e.srcElement;

        lnx.nav.navigate(target.getAttribute("data-navId"));

        e.stopPropagation ?
		e.stopPropagation() : (e.cancelBubble = true);

        /*e.preventDefault ?
        e.preventDefault() : ( e.returnValue = false );*/

    },

    onCertify: function(){
        lnx.scormApi.lmsCompleteCourse(true);
    },

    onTestResult: function( pass ) {

        lnx.scormApi.lmsCompleteCourse(pass);
        lnx.scormApi.lmsLogTestResult(pass);
        this.next();
    },


    onRetakeTest: function( id ) {

        id = id || this.TEST_RETAKE_ID;
        this.navigate(id);
    },

    takingTest: function(turnOn){
        this.disableAllNavBtns = turnOn === true;
    },


    next: function() {

        this.navigate("next");
    },


    previous: function(shift) {

        this.navigate("prev", false, shift);
    },

    goToScreen: function(i){
        var n = this.navNodes[i];
        if(n){
            this.navigate(n.getAttribute("navId"));
        }
    },

    navigate: function( navId, viaEdits, isShift ) {

        
        var self = this;
        var isSurvey = getIsSurvey();

        if(!isSurvey && this.disableAllNavBtns && (navId === "next" || navId === "prev")){
            console.log(navId + " nav event rejected");
            return;
        }

        function getIsSurvey(){
            if(
                self.disableAllNavBtns &&
                (navId === "next") && 
                ((self.navIndex + 1) < self.navNodes.length) && 
                (self.currNode.getAttribute("type") === "feedback") &&
                (lnx.scormApi.getTestCompletedSuccessfully())
            )        
            {
                console.log("going to survey");
                return true;
            } else {
                return false;
            }            
        }

        var node, idx = this.navIndex;
        var nodesLength = this.navNodes.length;
        var self = this;
        lnx.edits.tearDown();
        lnx.view.refPanel.show(false);
        //lnx.view.glossPanel.show(false);
        this.disableAllNavBtns = false;

        if (!navId) {
            // exit as required arg is missing
            // user has almsost certainly clicked between navigation buttons on navigation container
            // which has single listener attached and utilizes bubbling to catch nav clicks 
            return;
        }

        if(!this.currNode){
            // must be first visit to a screen;
            // this.currNode = this.navNodes[0];
            // this.navIndex = 0;
        }

        var prevNode = this.currNode;
        var prevType = this.currNodeType;
        
        if (navId === "prev") {

            if (!this.navIndex) {  // navIndex == 0 when at first screen
                if(!isShift){
                    // prevent reversing (and unlocking of linear nav) unless shift is down
                    return;
                }
                node = this.navNodes[this.navNodes.length-1];
                this.navIndex = this.navNodes.length-1;
            } else {
                node = this.navNodes[--this.navIndex];
            }            

        } else if (navId === "next") {

            if (!((this.navIndex + 1) < nodesLength)) {
                // node = this.navNodes[0];
                // this.navIndex = 0;
                node = this.navNodes[this.navIndex];
                return;
            } else {
                node = this.navNodes[++this.navIndex];
            }         

        } else { // passed 'ordinary' navId so find its matching node

            node = this.navNodeMap[navId];
            // make sure we've got a node before continuing
            if (!node) {
                // check is it custom link
                if(navId.substring(0, 5) === "link:"){
                    window.open(navId.substring(5));
                    return;
                }
                lnx.util.onError(
					"Failed to find navNode for navId: " + navId
				);
                return;
            }

            while (node.hasChildNodes()) {
                // it's a nav screen ancestor so drill down
                node = node.firstChild;
            }

            // use named prop added to array to find screen's index without looping
            var tIndex = this.navNodes[node.getAttribute("navId")];
			
            //special case added - never exit if screen to navigate to is home screen
			if(this.isLinearNav && (tIndex > this.farIndex + 1) && (tIndex !== this.navNodes[this.homeId])){
                // check if overlay reference panel should be shown
                if(this.alwayshowRef === node.getAttribute("navId")){
                    lnx.view.refPanel.show();
                }
				return;
			}
			
			this.navIndex = tIndex;

            // sanity check
            if (!this.navIndex && (this.navIndex !== 0)) {
                lnx.util.onError(
					"undefined screen index for navId: " + navId
				);
                // reset to current index
                this.navIndex = idx;
                return;
            }
        }

        // ignore navigation event if screen is 'must complete' and not completed
        // if((!isPriorNode()) && this.isLinearNav && prevNode && (prevNode.getAttribute("mustComplete") === "true")){
        //     if(!this.isScreenComplete(prevNode.getAttribute("navId"))){
        //         this.navIndex = idx;
        //         return;
        //     }
        // }

        // ignore navigation event if screen is 'must complete' and not completed
        if((!isPriorNode()) && 
                this.isLinearNav && 
                (((prevNode && prevNode.getAttribute("mustComplete") === "true")) || this.completeAllScreens) &&
                this.screenLocked
                //(((prevNode && prevNode.getAttribute("mustComplete") === "true") || !prevNode) || this.completeAllScreens)
        ){
            if(prevNode && !this.isScreenComplete(prevNode.getAttribute("navId"))){
                // if(!prevNode || !this.isScreenComplete(prevNode.getAttribute("navId"))){
                this.navIndex = idx;
                var screen = lnx.view.getCurrentScreen();
                if(screen && screen.OnNavEventRejectedNotice){
                    screen.OnNavEventRejectedNotice(navId);
                }
                return;
            }
        }

        // potentially ignore navigation event if screen is 'must complete' with value of 'request'
        // if((!isPriorNode()) && 
        //         this.isLinearNav && 
        //         (prevNode && prevNode.getAttribute("mustComplete") === "request")
        // ){
        //     if(prevNode && !this.isScreenComplete(prevNode.getAttribute("navId"))){
                
        //         var screen = lnx.view.getCurrentScreen();
        //         if(screen){
        //             if(screen.requestMustComplete()){
        //                 screen.OnNavEventRejectedNotice(navId);
        //                 this.navIndex = idx;
        //                 return;
        //             }
        //         }                
        //     }
        // }


        // check if nav action should be ignored - screen will display content as a virtual screen/nav event
        if(navId === "next" && this.insertVirtual(prevType, navId)){
    		this.navIndex = idx;
            this.screenLocked = getMustCompleteBeforeAdvance();
            if(this.screenLocked){
                lnx.view.disableFwdButton();
            }
        	return;
        }

        if(navId === "prev" && this.insertVirtual(prevType, navId, node.getAttribute("type"))){
            this.navIndex = idx;
            return;
        }

        // keep record of current navId for bookmarking
        this.currNavId = node.getAttribute("navId");
        this.currNodeType = node.getAttribute("type"); 
        this.currNode = node;      
				
		if(this.navIndex > this.farIndex){
			this.farIndex = this.navIndex;
			this.farNavId = this.currNavId;
            lnx.scormApi.uploadSuspendData(true);
		}			

        // kill any audio playing on old screen
        lnx.audio.stopAudio();
        var isLast = this.updateTerminalState(this.navIndex, nodesLength);
		if(isLast && this.isAutoCompletion) lnx.scormApi.lmsCompleteCourse(true);
		
		// if linear navigation style pass in index of furthest point in allNodes array
		var linear = this.isLinearNav ? {i:this.allNodes[this.farNavId], n:this.allNodes} : null;
        this.screenLocked = getMustCompleteBeforeAdvance();
        lnx.view.update(node, this.terminals, this.screensMap, linear, this.screenLocked, navId);
        if(!viaEdits) lnx.edits.setUp();
        lnx.overlayMan.hide();
        lnx.nav.tocPanel.hide();

        lnx.progBar.positionSlider(this.navIndex);

        if(this.disableAllNavBtns){
            lnx.view.disableNavButtonsState();
        }


        function getMustCompleteBeforeAdvance(){
            if(!self.isLinearNav) return false;
            if(node.getAttribute("mustComplete") === "true" || self.completeAllScreens){
                if(lnx.scormApi.getIsCourseComplete()) return false;
                if(isPriorNode()) return false;
                if(self.isScreenComplete(self.currNavId)) return false;/**/
                if(self.completeAllScreens && !hasAudio()){
                    return false;
                }
                if(!self.currNode){
                    // must be first screen
                    return false;
                }
                //temp fix for virtual screen followed by must complete screen
                var screen = lnx.view.getCurrentScreen();
                if(!self.completeAllScreens && screen && screen.getStillHasScreens && screen.getStillHasScreens()){
                    return false;
                }
                return true;
            } else {
                return false;
            }           
        }

        function isPriorNode(){
            return self.navIndex < self.farIndex;
        }

        function hasAudio(){
            var screen = self.getScreenFromNodeId(self.currNavId);
            if(!screen){
                return false;
            }
            if(lnx.config.noAudio){
                return false;
            }
            var s = screen.outerHTML;
            var r = /data-(auto)?Audio="(\w+)(:\w+)?\"/i.exec( s );
            if(r && r[2] != "0"){
                return true;
            }
            // if( /data-autoAudio="\w+\"/.test( s )){
            //     return true;
            // }
            //  if( /data-audio="\w+\"/.test( s )){
            //     return true;
            // }
            return false;
        }

    },

    // setMustComplete: function(navId){
    //     let n = node = this.navNodeMap[navId];
    //     if(n){
    //         n.setAttribute("mustComplete", "true");
    //         this.setIsScreenLocked(true);
    //     }
    // },

    insertVirtual: function(type, dir){
    	if(!this.mustCompleteMap[type]) return false;
        // Abbott now want this to always operate
    	// if(lnx.scormApi.getIsCourseComplete()) return false;
    	// if(!(this.navIndex > this.farIndex)) return false;
    	var screen = lnx.view.getCurrentScreen();
    	if(!(screen && screen.insertVirtualScreen)){
    		// problem, allow navigation anyway
    		return false;
    	}
    	if(!screen.insertVirtualScreen(dir)) return false;
        if(screen.getResId){
            lnx.view.updateDebugBox(null, screen.getResId());
        }
    	return true;
    },

    isScreenComplete: function(id){
        return lnx.cache.getValue("complete", id);
    },    

    getIsScreenLocked: function(){
        return this.screenLocked;
    },

    setIsScreenLocked: function(v){
        return (this.screenLocked = v);
    },

    getScreenFromNodeId: function(id){
    	return this.screensMap[id]
    },

    getCurrentNode: function(){
    	return this.currNode;
    },

    getCurrentScreenId: function(){
        if(!this.currNode) return null;
        return this.currNode.getAttribute("navId");
    },

    getCurrentNavIds: function(id){
        var n;
        if(id){
            n = id;
        } else if(!this.currNode){
            return null;
        } else {
            n = this.currNode;
        }
    	var a = [null, null, null];
    	a[2] = n.getAttribute("navId");
    	n = this.currNode.parentNode;
    	if(n) a[1] = n.getAttribute("navId");
    	n = n.parentNode;
    	if(n) a[0] = n.getAttribute("navId");
    	return a;
    },

    getTopicsStatus: function(){

        let results = {};
        let m = this.toc.querySelectorAll("nav[required='true']");
        let isLocked = this.isLinearNav && (!lnx.scormApi.getIsCourseComplete());
        let lastTopicComplete = false;
        // let homeScreenIndex = this.navNodes[this.homeId];
        // let autoAvailable = this.farIndex >= homeScreenIndex; 

        for(let i=0;i<m.length;i++){
            let mo = results[m[i].getAttribute("navId")] = {topics: {}, complete: true, available: true, id: m[i].getAttribute("navId"), index: (i + 1)};
            let t = m[i].childNodes;
            let atLeastOneTopicAvailble = false;

            for(let j=0;j<t.length;j++){                
                let tId = t[j].getAttribute("navId");
                let lastScreenIndexInTopic = this.navNodes[t[j].lastChild.getAttribute("navId")];
                let firstScreenIndexInTopic = this.navNodes[t[j].firstChild.getAttribute("navId")];

                let to = mo.topics[tId] = {};
                to.complete = lastScreenIndexInTopic <= this.farIndex ? true : false;
                to.available = firstScreenIndexInTopic <= this.farIndex ? true : false;
                to.firstScreenId = t[j].firstChild.getAttribute("navId");

                if(!to.available  && 
                    ((i == 0 && j == 0) || !isLocked)){
                    to.available = true;
                }
                //if previous topic completed, make this one available
                if(!to.available && lastTopicComplete){
                    to.available = true;
                }
                if(to.available){
                    atLeastOneTopicAvailble = true;
                }
                if(!to.complete){
                    mo.complete = false;
                    lastTopicComplete = false;
                } else {
                    lastTopicComplete = true;
                }
            }
            if(!atLeastOneTopicAvailble){
                mo.available = false;
            }
            
        }
        return results;        
    },

    isFarIndexBeforeHomeScreen: function(){
        let homeScreenIndex = this.navNodes[this.homeId];
        return this.farIndex < homeScreenIndex; 
    },

    goToHomeScreen: function(){
        this.navigate(this.homeId);
    },

    updateTerminalState: function( idx, len ) {

        // function assumes > 1 screen

        if (idx === 0) {
            // first screen
            this.terminals.isFirst = true;
            this.terminals.isLast = false;
        } else if ((idx + 1) === len) {
            // last screen
            this.terminals.isLast = true;
            this.terminals.isFirst = false;
        } else {
            // neither first or last screen
            this.terminals.isLast = this.terminals.isFirst = false;
        }
		return this.terminals.isLast;
    },


    destroy: function() {

        var exitBtn = document.getElementById("exitBtn");
        lnx.util.updateEventListener(exitBtn, "click", this.onExitCourse, true);

        var audioBtn = document.getElementById("audioBtn");
        lnx.util.updateEventListener(audioBtn, "click", this.onAudioUpdate, true);

        lnx.util.updateEventListener(window, "pagehide", this.onPageHide, true);
		
		this.content = this.toc = this.screens = this.navNodes = this.navNodeMap = this.screensMap = this.templateMap = null;
		
		lnx.view.destroy( this.onNavigate );
    }

};


lnx.nav.tocPanel = {

    overlay: null,
    closeBtn: null,
    payLoad: null,
    html: "",
    currNodes: [],
    initialized: false,

    init: function(n){
        var self = this;
        var btn = document.body.querySelector(".tocBtn");
        if(!btn) return;

        btn.onclick = this.show.bind(this);
        this.overlay = document.body.querySelector("div.overlay.tocPanel");
        this.overlay.querySelector("img").onclick = function(){
            self.hide();
        };
        // this.overlay.onclick = function(e){
        //     self.selection(e);
        // };
        this.overlay.addEventListener("click", this.selection.bind(this));

        this.payLoad = this.overlay.querySelector("div:nth-of-type(2)");
        this.parseToc(n, 1);
        this.payLoad.innerHTML = this.html;
        this.initialized = true;
    },

     parseToc: function( n , level) {

        for (var i = 0, len = n.childNodes.length; i < len; i++) {
            if (n.childNodes[i].nodeType !== 1) {
                continue;
            }
            var nd = n.childNodes[i];
            this.html += '<p class="tocListL' + level + '" navId="' + nd.getAttribute("navId") + '">' + nd.getAttribute("title") + '</p>';            
            if (n.childNodes[i].hasChildNodes() && (level < 2)) {
                this.parseToc(n.childNodes[i], 2);
            }
        }
    },

    selection: function(e){
        var navId = e.target.getAttribute("navId");
        if(navId){
            lnx.nav.navigate(navId);
            this.hide();
        }
    },

    show: function(){
        if(!this.initialized) return;
    	if(this.currNodes.length){
    		this.currNodes[0].classList.remove("tocItemOn");
    		this.currNodes[1].classList.remove("tocItemOn");
    	}
    	var ids = lnx.nav.getCurrentNavIds();
    	var p = this.payLoad.querySelector('p[navId="' + ids[0] + '"]');
    	p && p.classList.add("tocItemOn");
    	this.currNodes[0] = p;
    	p = this.payLoad.querySelector('p[navId="' + ids[1] + '"]');
    	p && p.classList.add("tocItemOn");
    	this.currNodes[1] = p;
        this.overlay.style.display = "block";
    },

    hide: function(){
        if(!this.initialized) return;
        this.overlay.style.display = "none";
    }

};


// this object handles rendering of navigation menu, content title and
// and content screens
lnx.view = {

    // Strings corresponding to main html nav and view element id values
    ELM_IDS: [
		"mainNav",
		"subNav",
		"screenNav",
		"screenNavFooter",
		"screenFrame",
		"contentTitle",
        "moduleTitle"
	],

    ELM_IDS2: [
        "fwdBtn", 
        "backBtn", 
        "fwdBtnF", 
        "backBtnF",
        "screenFrame",
        "contentTitle",
        "moduleTitle"
    ],

    // holds refs to main html navigation and view elements
    elements: {},

    courseTitleElm: null,

    // arrays of xml navigation nodes used to build navigation menu
    mainNavNodes: [],
    subNavNodes: [],
    screenNavNodes: [],

    // map of screen types
    screenTypes: null,
    // ref to div element within which screens of content display 
    screenFrame: null,
    // ref to current screen js object
    currScreen: null,
    // cache for fwd btn refs
    disabledFwdBtns: null,
    allwaysShowRefNode: null,
    toc: null,
    contentTitleFontSize: null,
    debugBox: null,
    rootElm: null,
    topicNav: null,
    navProgBar: null,


    init: function( tocNodes, navHandler, isAudioOn,  hideAudio, isFrameWork2) {

        // each type has a corresponding js object which handles interaction etc
        this.screenTypes = {
            "assessment": lnx.assessment,
            "test": lnx.assessment, "feedback": lnx.assessmentFeedback,
            "testIntro": lnx.assessmentIntro, "slideshow": lnx.slideShow,
            "scenario": lnx.scenario, "accordian": lnx.accordian,
            "panel": lnx.panel, "video": lnx.video, "multiPanel": lnx.multiPanel,
            "learnHow": lnx.learnHow, "matching": lnx.matching, 
            "imgSequence": lnx.imgSequence, "basic": lnx.basic,
            "learningCheck": lnx.learningCheck,
            "selectReveal": lnx.selectReveal, "selectRevealEmail": lnx.selectRevealEmail,
            "hasVirtualScreenOverlay": lnx.hasVirtualScreenOverlay, "acknowledge": lnx.acknowledge,
            "autoVideo": lnx.autoVideo, "clickAndPopup": lnx.clickAndPopup, "clickAndPopupSelection": lnx.clickAndPopupSelection,
            "videoScenario": lnx.videoScenario, "scenarioWithVirtualScreens": lnx.scenarioWithVirtualScreens, 
            "introPanel": lnx.introPanel, "moveUp": lnx.moveUp, "steps": lnx.steps, "basicWithVideo": lnx.basicWithVideo,
            "dialogueWithVirtualScreens": lnx.dialogueWithVirtualScreens, "certification": lnx.certification,
            "verticalScenario": lnx.verticalScenario,
            "dialogue": lnx.dialogueWithVirtualScreens,
            "stages": lnx.stages,
            "home": lnx.home,
            "flashCard": lnx.flashCard,
            "verticalParallax": lnx.verticalParallax,
            "infoGraphicVirtualScreens1": lnx.infoGraphicVirtualScreens1,
            "infoGraphicVirtualScreens2": lnx.infoGraphicVirtualScreens2,
            "infoGraphicGen": lnx.infoGraphicGen,
            "flowChartAnimation": lnx.flowChartAnimation,
            "drawFCchart": lnx.drawFCchart,
            "blurBoxQuestion": lnx.blurBoxQuestion,
            "emailAnim1": lnx.emailAnim1,
            "emailAnim2": lnx.emailAnim2,
            "survey": lnx.survey,
            "toc": lnx.toc,
            "confirmation": lnx.confirmation,
            "quickCheck": lnx.quickCheck,
            "animVer": lnx.animVer,
            "clickAndAnimateText": lnx.clickAndAnimateText,
            "sliderIcons": lnx.sliderIcons
        };

        this.topicNav = document.querySelectorAll(".navProg > p");
        this.navProgBar = document.querySelectorAll(".navProgBar");

        this.rootElm = document.documentElement;

        if(isFrameWork2){
            this.ELM_IDS = this.ELM_IDS2;
        }

        this.debugBox = document.getElementById("debugBox");
        if(lnx.config.ignoreLMS && (!lnx.config.screenShotMode) && this.debugBox && !lnx.config.hideDebugBox){
            this.debugBox.style.display = "block";
        }

        // get refs to main html doc elements and store in elements object
        for (var i = 0, len = this.ELM_IDS.length; i < len; i++) {
            this.elements[this.ELM_IDS[i]] = document.getElementById(this.ELM_IDS[i]);
        }

        // shortcut reference
        this.screenFrame = this.elements.screenFrame;

        //this.setCourseTitle();
        this.contentTitleFontSize = parseFloat(window.getComputedStyle(this.elements.contentTitle).fontSize) / parseFloat(window.getComputedStyle(document.documentElement).fontSize);

        this.toc = this.buildMenu(tocNodes, navHandler, isFrameWork2);

        if ((!isAudioOn) || hideAudio) {
            var audioBtn = document.getElementById("audioBtn");
            this.updateAudioIcon(audioBtn, isAudioOn, hideAudio);
        }

        lnx.toc.createTocModal();
    },

    showToc: function(hide){
        // if(hide === false){
        //     toc.style.display = "none";
        // } else {
        //     toc.style.display = "block";
        // }
        //lnx.nav.navigate(lnx.nav.homeId);
        //lnx.toc.showTocModal();
    },

    setAlwaysShowRefOn: function(id){
        //this.allwaysShowRefNode = this.elements.mainNav.querySelector('li[data-navid="' + id + '"]');
    },

    updateDebugBox: function(node, resId){
        var d = this.debugBox;
        if(d){
            if(resId){
                d.innerHTML = resId;
                return;
            }
            d.innerHTML = node.getAttribute("resId");
            if(node.getAttribute("type") === "dialogueWithVirtualScreens"){
                d.innerHTML = lnx.dialogueWithVirtualScreens.getResId();
            }
        }
    },

    setCourseTitle: function() {

        this.courseTitleElm = document.getElementById("courseTitle");
        this.courseTitleElm.innerHTML = lnx.localization.getLocalString("s9");

        var a = ["tocBtn", "helpBtn", "refBtn", "audioBtn", "exitBtn"]
        for(var i = 0; i < a.length; i++){
            var elm = document.getElementById(a[i]);
            if(!elm){
                continue;
            }
            elm.setAttribute("title", lnx.localization.getLocalString("s" + (i+14)));
        }
    },


    updateTitle: function( node ) {
        
        var title = node.getAttribute("displayTitle") || node.getAttribute("title");
        var mTitle;
        var fontClass = null;
        while (node && !title) {
            node = node.parentNode;
            title = node.getAttribute("displayTitle") || node.getAttribute("title");
            fontClass = node.getAttribute("fontSize");
        }
        if (title) {
            var tElm = this.elements.contentTitle;            
            tElm.style.fontSize = this.contentTitleFontSize + "rem";
            if(node.parentNode){
                mTitle = node.parentNode.getAttribute("title") || "";
            }
            this.elements.moduleTitle && (this.elements.moduleTitle.innerHTML = mTitle);
            // if(fontClass){
            //     title = "<span class=\"" + fontClass + "\">" + title + "</span>";
            // }            
            tElm.innerHTML = title;
            var lh = parseFloat(window.getComputedStyle(tElm).lineHeight);
            var i = 1;
            var fs = this.contentTitleFontSize;
            var reducer = 0;
            while (parseInt(window.getComputedStyle(tElm).height) > lh) {                
                var rem = fs - (reducer += .1);
                tElm.style.fontSize = "" + rem + "rem";
                if (reducer > 3) {
                    break;
                }
            }
        }
    },


    updateCourseTitleColor: function( idx ) {

        this.courseTitleElm.className = ".titleText titleTextColor" + idx;
    },    

    buildMenu: function( tocNodes, navHandler, isFrameWork2) {

        // not using this toc menu for framework 3
        //return;

        if(isFrameWork2){
            return this.buildMenu2(tocNodes, navHandler, isFrameWork2);
        }         

        this.buildMainNavMenu(tocNodes);
        this.buildSubNavMenu(this.mainNavNodes[0].childNodes);
        this.buildScreensNavMenu(this.subNavNodes[0].childNodes);
        this.updateTitle(this.mainNavNodes[0].childNodes[0]);

        var evtTargs = [
			this.elements.mainNav,
			this.elements.subNav,
			this.elements.screenNav,
			this.elements.screenNavFooter
		];
        // add event listeners
        lnx.util.updateEventListener(evtTargs, "click", navHandler);        
    },

    buildMenu2: function( tocNodes, navHandler, isFrameWork2) {
        
        var self = this;
        var tocCon = this.buildVerticalMenu(tocNodes); 
        var toc = tocCon.parentNode;
        var mods = tocCon.querySelectorAll(".moduleItem");
        var curMod = null;            
        var openToc = document.getElementById("tocBtn");
        var closeToc = toc.querySelectorAll(".tocHeader > img")[1];
        lnx.util.updateEventListener(tocCon, "click", viewHandler);
        lnx.util.updateEventListener([openToc, closeToc], "click", showToc);
        var navBtns = document.documentElement.querySelectorAll("#player .navBtn");
        lnx.util.updateEventListener(Array.prototype.slice.call(navBtns), "click", viewHandler);
        lnx.util.updateEventListener(toc.querySelector("div.popUnderlay"), "click", onClickUnderlay);        

        return toc;     

        function onClickUnderlay(e){
            if(e.target === e.currentTarget){
                showToc(e);
            }
        }     

        function showToc(e){
            // if(e.target.getAttribute("data-show")){
            //     toc.style.display = "block";
            // } else {
            //     toc.style.display = "none";
            // }
            //lnx.nav.navigate(lnx.nav.homeId);
            lnx.toc.showTocModal(e);
        }

        function viewHandler(e){
            var targ = e.target;
            if(targ.nodeName.toLowerCase() === "img"){
                targ = targ.parentNode;
            }
            var navId = targ.getAttribute("data-navId"); 
            if(navId && navId.substring(0,1).toLowerCase() === "a"){
                if(curMod && curMod.getAttribute("data-navid") === navId){
                    updateTocView(null, curMod);
                    updateIcon(curMod, false);
                    curMod = null;
                    return;
                }
                for(var i=0, len=mods.length;i<len;i++){
                    if(mods[i].getAttribute("data-navid") === navId){
                        updateTocView(mods[i], curMod);
                        updateIcon(curMod, false);
                        curMod = mods[i];
                        updateIcon(curMod, true);
                        break;
                    }
                }
            } else {
                navHandler(e);
            }
        }

        function updateTocView(show, hide){
            show && (show.nextElementSibling.style.display = "block");
            hide && (hide.nextElementSibling.style.display = "none");
        }            

        function updateIcon(elm, show){
            if(elm){
                var img = elm.querySelector("img");
                if(img){
                    var url = show ? "images/modIconD.png" : "images/modIcon.png";
                    img.src = url;
                }
            }
        }
    },


    buildVerticalMenu: function(tocNodes){

        var mHTML = '<div class="moduleCon"><div class="moduleItem" data-navId="$a"><img src="images\/modIcon.png"/>$b<\/div><div class="topicCon">';
        var tHTML = '<div class="topicItem" data-navId="$a">$b<hr/><\/div>';
        var eHTML = '<\/div><\/div>';
        var s = '';

        for(var i = 0; i < tocNodes.length; i++){
            s += genModule(tocNodes[i]);
        }
        //console.log(s);
        var tocCon = window.document.querySelector(".tocContainer");
        tocCon.innerHTML = s;
        return tocCon;


        function genModule(n){
            var s = mHTML.replace("$a", n.getAttribute("navId")).replace("$b", n.getAttribute("title"));
            s += genTopics(n.childNodes);            
            s += eHTML;
            return s;
        }

        function genTopics(n){
            var s = '';
            for(var i = 0; i < n.length; i++){
                if(n[i].nodeType === n[i].COMMENT_NODE){ 
                    continue;
                }
                s += tHTML.replace("$a", n[i].getAttribute("navId")).replace("$b", n[i].getAttribute("title"));
            }
            return s;            
        }

    },

    buildMainNavMenu: function( nodes ) {

        var NAV_LEVEL = 1;
        var iHTML = this.genHTML(nodes, this.mainNavNodes, NAV_LEVEL);
        this.elements.mainNav.innerHTML = iHTML;

        // workaround for ie 8's lack of last-child css
        //this.elements.mainNav.lastChild.style.border = "none";
    },


    buildSubNavMenu: function( nodes ) {

        var NAV_LEVEL = 2;
        var iHTML = this.genHTML(nodes, this.subNavNodes = [], NAV_LEVEL);
        this.elements.subNav.innerHTML = iHTML;
    },


    buildScreensNavMenu: function( nodes, firstElm ) {

        var NAV_LEVEL = 3;

        // images referenced in css
        var prevHTML = "<div data-navId='prev' class='screenBtnPrev'  unselectable='on'></div>";
        var nextHTML = "<div data-navId='next' class='screenBtnNext'  unselectable='on'></div>";

        var f = lnx.config.isR2L ? "genR2LScreenHTML" : "genHTML";

        var iHTML = prevHTML + this[f](nodes, this.screenNavNodes = [], NAV_LEVEL) + nextHTML;

        // header nav buttons
        this.elements.screenNav.innerHTML = iHTML;

        // footer nav buttons
        this.elements.screenNavFooter.innerHTML = iHTML;
    },


    genHTML: function( nodes, list, level ) {

        var navId, iHTML = "";
		var pageNum = 0;
        for (var i = 0; i < nodes.length; i++) {

            if (nodes[i].nodeType !== 1 || !(navId = nodes[i].getAttribute("navId"))) {
                continue;
            }
			
            switch (level) {

                case 1:
                    {
                        iHTML += "<li data-navId='" + navId + "' class='mainNavLi mainNavLiColor" + i + "'>" + nodes[i].getAttribute("title") + "<\/li>";
                        break;
                    }
                case 2:
                    {
                        iHTML += "<li data-navId='" + navId + "' class='subNavLi'>" + nodes[i].getAttribute("title") + "<\/li>";
                        break;
                    }
                case 3:
                    {
                        iHTML += "<div data-navId='" + navId + "' class='screenBtn'>" + (++pageNum) + "<\/div>";
                        break;
                    }
            }
            list.push(nodes[i]);
        }
        return iHTML;
    },
	
	
	genR2LScreenHTML: function( nodes, list, level ) {
		// ToDo add second loop as pageNum will be incorrect if xml includes non element nodes
		var navId, iHTML = "", pageNum = nodes.length;

        for (var i = nodes.length - 1; i >= 0; i--) {

            if (nodes[i].nodeType !== 1 || !(navId = nodes[i].getAttribute("navId"))) {
                continue;
            }

           	iHTML += "<div data-navId='" + navId + "' class='screenBtn'>" + (pageNum--) + "<\/div>";
          
            list.push(nodes[i]);
        }
        return iHTML;
    },
	
	
	update: function( node, terminals, screensMap, linear, disableFwdBtn, navId ) {

        if(disableFwdBtn){
            this.disableFwdButton();
        }
        this.updateScreenView(node, screensMap, navId);
        this.updateNavView(node, terminals, linear, disableFwdBtn);
    },

    disableFwdButton: function(){
        if(lnx.nav.completeAllScreens){
            var audioBtn = document.getElementById("audioBtn");
            this.updateAudioIcon(audioBtn, true);
            lnx.audio.setAudioOn(true);
        }        
        var e = lnx.view.elements;
        e.fwdBtn.classList.add("fwdBtnDisabled");
        e.fwdBtnF.classList.add("fwdBtnDisabled");
        this.disabledFwdBtns = [e.fwdBtn, e.fwdBtnF];
    },

    onScreenComplete: function(){
        if(this.disabledFwdBtns){     
            if(lnx.nav.isFrameWork2){
                if(!lnx.nav.terminals.isLast){
                this.disabledFwdBtns[0].classList.remove("fwdBtnDisabled");
                this.disabledFwdBtns[1].classList.remove("fwdBtnDisabled");
            } else {
                    // don't null disabledFwdBtns array
                    return;
                }         
            } else {
           this.disabledFwdBtns[0].className = this.disabledFwdBtns[1].className = "screenBtnNext";
        }
        }
        this.disabledFwdBtns = null;
    },

    getCurrentScreen: function(){
    	return this.currScreen;
    },

    updateScreenView: function( node, screensMap, origNavId ) {

        var type = node.getAttribute("type");
        var navId = node.getAttribute("navId");

        this.currScreen && this.currScreen.destroy(type, navId);

        this.currScreen = this.screenTypes[type];

        if (!this.currScreen) {
            lnx.util.onError("No screenType for type attrib: " + type);
            return;
        }

        // allow a screen to render its own content accross multiple screens
        // currently only assessment does this
        if (!this.currScreen.hasContent()) {
            var iHTML = this.getScreenContent(node, screensMap);
            this.screenFrame.innerHTML = iHTML;
            this.screenFrame.style.opacity = "0";
            var tl = new TimelineMax();
            tl.to(this.screenFrame, 1, {opacity : 1});
        }
        // rename to process rather than init
        this.screenTypes[type].init(node, this.screenFrame.firstChild, this.screenFrame, origNavId);

        lnx.audio.autoPlayAudio(node, this.screenFrame.firstChild);
    },


    // returns string of html markup keyed off toc node attribute
    getScreenContent: function( node, screensMap ) {

        // Use a targetId(when available) or a navId to map a navigation node to a content screen.
        // Currently only the assessment uses targetIds.
        // targetIds allow for multiple navigation nodes to point to a single target content screen, in this case a form.
        // The individual form questions are essentially virtual screens - they appear in the navigation xml 
        // but do not map to seperate content screen elements. 
        // A targetId therefore allows a group of xml navigation nodes point to the same resource.
        // screens are ultimatley be rendered as html markup
        var sId = node.getAttribute("targetId") ? node.getAttribute("targetId") : node.getAttribute("navId");
        if(!sId){
            // may be a screen
            if(node && node.getAttribute("class").includes("helpPage")){
                sId = node.getAttribute("id");
            }
        }

        var n = screensMap[sId];
        if (!n) {
            return "";
        } else {
            var r = lnx.util.XMLToString(n);
            return r;
        }

    },


    updateNavView: function( node, terminals, linear, disableFwdBtn ) {

        if(lnx.nav.isFrameWork2){
            this.updateNavView2(node, terminals, linear, disableFwdBtn);
            return;
        } 
       
        var subNavNode = node.parentNode;
        var mainNavNode = subNavNode.parentNode;
        var navId = mainNavNode.getAttribute("navId");
        var elms = this.elements.mainNav.childNodes;
        var elmsFooter;
        var mainNavColorIndex;
		// is item enabled	
		var enabled = false;

        this.disabledFwdBtns = null;
		
		for (var i = elms.length - 1; i > -1; i--) {
			
			var nId = elms[i].getAttribute("data-navId");
			if(linear && !enabled && (linear.n[nId] < linear.i)){
				enabled = true;
			}				
			
            if (nId === navId) {
                elms[i].className = "mainNavLiOn mainNavLiColor" + i;
                mainNavColorIndex = i;
            } else {
				var cn = "mainNavLi mainNavLiColor" + i;
				if(linear && !enabled){
					cn = "mainNavLiDisabled";
				}
                elms[i].className = cn;
            }
        }

        this.buildSubNavMenu(mainNavNode.childNodes);
        navId = subNavNode.getAttribute("navId");
        elms = this.elements.subNav.childNodes;
		enabled = false;
		
		for (var i = elms.length - 1; i > -1; i--) {
			
			var nId = elms[i].getAttribute("data-navId");
			if(linear && !enabled && (linear.n[nId] < linear.i)){
				enabled = true;
			}				
			
            if (nId === navId) {
                elms[i].className = "subNavLiOn" + ((lnx.config.courseId === "aac") ? (" bgColor" + mainNavColorIndex) : "");
            } else {
				var cn = "subNavLi subNavLi" + mainNavColorIndex;
				if(linear && !enabled){
					cn = "subNavLiDisabled";
				}
                elms[i].className = cn;
            }
        }

        this.buildScreensNavMenu(subNavNode.childNodes);
        navId = node.getAttribute("navId");
        elms = this.elements.screenNav.childNodes;
        elmsFooter = this.elements.screenNavFooter.childNodes;

        var prevIdx, nextIdx;
		enabled = false;
				
        // screenNavFooter elements mirror screenNav elements
		for (var i = elms.length - 1; i > -1; i--) {

            if (elms[i].getAttribute("data-navId") === "prev") {
                prevIdx = i;
                continue;
            }
            if (elms[i].getAttribute("data-navId") === "next") {
                nextIdx = i;
                continue;
            }
			
			var nId = elms[i].getAttribute("data-navId");
			if(linear && !enabled && (linear.n[nId] < linear.i)){
				enabled = true;
			}

            if (nId === navId) {
                elms[i].className = elmsFooter[i].className = "screenBtnOn";
            } else { /*if (elms[i].className === "screenBtnOn") {*/
				var cn = "screenBtn";
				if(linear && !enabled){
					cn = "screenBtnDisabled";
				}
                elms[i].className = elmsFooter[i].className = cn;
            }
        }

        if (terminals.isFirst) {
            elms[prevIdx].className = elmsFooter[prevIdx].className = "hide";
            elms[nextIdx].className = elmsFooter[nextIdx].className = "screenBtnNext";
        } else if (terminals.isLast) {
            elms[nextIdx].className = elmsFooter[nextIdx].className = "hide";
            elms[prevIdx].className = elmsFooter[prevIdx].className = "screenBtnPrev";
        } else {
            elms[prevIdx].className = elmsFooter[prevIdx].className = "screenBtnPrev";
            elms[nextIdx].className = elmsFooter[nextIdx].className = "screenBtnNext";
        }
        // show disabled fwd btn for screens whose activity must be completed before u can navigate
        if(disableFwdBtn  && (!terminals.isLast)){
            elms[nextIdx].className = elmsFooter[nextIdx].className = "screenBtnNextDisabled";
            this.disabledFwdBtns = [elms[nextIdx], elmsFooter[nextIdx]];
        }

		// uncomment following to update color of course tilte to match section color
        //this.updateCourseTitleColor(mainNavColorIndex);
        this.updateTitle(node);

        if(this.allwaysShowRefNode &&
            this.allwaysShowRefNode.classList.contains("mainNavLiDisabled")){
            this.allwaysShowRefNode.classList.remove("mainNavLiDisabled");
            this.allwaysShowRefNode.classList.add("mainNavLi");
        }
    },
	
    updateNavView2: function( node, terminals, linear, disableFwdBtn ) {
         this.updateTitle(node);
         this.updateDebugBox(node);
         this.updateTopicNav(node);

         var e = lnx.view.elements;
         if (terminals.isFirst) {
            e.backBtn.classList.add("backBtnDisabled"); e.backBtnF.classList.add("backBtnDisabled");
            e.fwdBtn.classList.remove("fwdBtnDisabled"); e.fwdBtnF.classList.remove("fwdBtnDisabled");
        } else if (terminals.isLast) {
            e.backBtn.classList.remove("backBtnDisabled"); e.backBtnF.classList.remove("backBtnDisabled");
            e.fwdBtn.classList.add("fwdBtnDisabled"); e.fwdBtnF.classList.add("fwdBtnDisabled");
        } else {
            e.backBtn.classList.remove("backBtnDisabled"); e.backBtnF.classList.remove("backBtnDisabled");
            e.fwdBtn.classList.remove("fwdBtnDisabled"); e.fwdBtnF.classList.remove("fwdBtnDisabled");
        }
        // show disabled fwd btn for screens whose activity must be completed before u can navigate
        if(disableFwdBtn  && (!terminals.isLast)){          
            e.fwdBtn.classList.add("fwdBtnDisabled");
            e.fwdBtnF.classList.add("fwdBtnDisabled");
            this.disabledFwdBtns = [e.fwdBtn, e.fwdBtnF];
        }
    },

    updateTopicNav: function(node){        

        var e = node.parentNode.parentNode;
        var c = e.querySelectorAll("nav[type]");
        var len = c.length;
        var index;
        for(var i=0;i<len;i++){
            if(c[i] === node){
                index = i + 1;
                break;
        }        
        }
        var a = index;
        var b = len;
        if(b === 0){
            this.navProgBar[0].style.width = "0";
            this.navProgBar[1].style.width = "0";
            this.topicNav[0].innerText = "";
            this.topicNav[1].innerText = "";
            return;
        }
        
        var w = 1.9;
        this.topicNav[0].innerText = a + "/" + b;
        this.topicNav[1].innerText = a + "/" + b;

        this.navProgBar[0].style.width = (a/b * w) + "rem";
        this.navProgBar[1].style.width = (a/b * w) + "rem";
        
    },

    disableNavButtonsState: function(){
        var e = lnx.view.elements;
        e.backBtn.classList.add("backBtnDisabled"); 
        e.backBtnF.classList.add("backBtnDisabled");
        e.fwdBtn.classList.add("fwdBtnDisabled");
        e.fwdBtnF.classList.add("fwdBtnDisabled");
    },

    enableNavButtonFwdState: function(){
        var e = lnx.view.elements;
        e.fwdBtn.classList.remove("fwdBtnDisabled");
        e.fwdBtnF.classList.remove("fwdBtnDisabled");
    },

    updateAudioIcon: function( target, isOn, hide ) {
        
        var audioOn = target.getAttribute("data-audioOn");
        var isBgImg = audioOn.substring(0, 3) === "url";
        if (isOn) {
            if(isBgImg){
                target.style.backgroundImage = audioOn;            
            } else {
                target.src = audioOn;
            }
        } else {
            var audioOff = target.getAttribute("data-audioOff");
            if(isBgImg){
                target.style.backgroundImage = audioOff;        
            } else {
                target.src = audioOff;
            }
        }
        if(hide){
            target.style.display = "none";
        }
    },

    clearScreenFrame: function() {

        this.screenFrame.innerHTML = "";
    },

    showUserNoticeGen: function(m){
        var p = this.screenFrame.querySelector(".userNotice");
        if(!p){
            p = document.createElement("p");
            p.className = "userNotice showUserNoticeWithAnim";
            p.innerHTML = m || "You must listen to all audio before moving forward";
            this.screenFrame.appendChild(p);
        }        
    },
	
	
	destroy: function( navHandler ){
		
		var evtTargs = [
			this.elements.mainNav,
			this.elements.subNav,
			this.elements.screenNav,
			this.elements.screenNavFooter
		];

        // remove event listeners if elements defined - only need to check first
		evtTargs[0] && lnx.util.updateEventListener(evtTargs, "click", navHandler, true);
		
		this.courseTitleElm = this.elements = this.screenFrame = this.currScreen = this.screenTypes = null;
		this.mainNavNodes = this.subNavNodes = this.screenNavNodes = null;
		
		// clear screen in case window.close fails
		var elm = document.getElementById("body");
		elm && (elm.innerHTML = "");
	}

};

lnx.view.refPanel = {

    overlay: null,
    closeBtn: null,
    active: false,

    init: function(node, screensMap, title, refId){

        var self = this;
        this.overlay = document.getElementById("player").appendChild(document.createElement("div"));
        this.overlay.className = "overlay refPanel";
        this.overlay.innerHTML = '<div class="refCloseBtn"><img src="images/tocClose.svg"></div><div class="refContent"></div>';
        this.overlay.querySelector(".refCloseBtn").onclick = function(){
            self.show(false);
        };
        //this.overlay.querySelector('.refTitle').innerHTML = title;
        this.overlay.querySelector('.refContent').innerHTML = lnx.view.getScreenContent(node, screensMap);
        // var s = this.overlay.querySelector('.refContent ul').innerHTML;
        // this.overlay.querySelector('.refContent').innerHTML = s;
        lnx.view.setAlwaysShowRefOn(refId);
        //this.show();       
    },

    show: function(s){
        if(!this.overlay) return;
        if(s === undefined){
            s = !this.active;
            this.active = s;
        } else {
            this.active = s === false ? false : true;
        }
        this.overlay.style.display = s === false ? "none" : "block";
    }

};

lnx.view.glossPanel = {

    overlay: null,
    closeBtn: null,
    active: false,

    init: function(node, screensMap, title, refId){

        var self = this;
        this.overlay = document.getElementById("player").appendChild(document.createElement("div"));
        this.overlay.className = "overlay refPanel";
        this.overlay.innerHTML = '<div class="refCloseBtn"><img src="images/tocClose.svg"></div><div class="refContent"></div>';
        this.overlay.querySelector(".refCloseBtn").onclick = function(){
            self.show(false);
        };
        //this.overlay.querySelector('.refTitle').innerHTML = title;
        this.overlay.querySelector('.refContent').innerHTML = lnx.view.getScreenContent(node, screensMap);
        // var s = this.overlay.querySelector('.refContent ul').innerHTML;
        // this.overlay.querySelector('.refContent').innerHTML = s;
        //lnx.view.setAlwaysShowRefOn(refId);
        //this.show();       
    },

    show: function(s){
        if(!this.overlay) return;
        if(s === undefined){
            s = !this.active;
            this.active = s;
        } else {
            this.active = s === false ? false : true;
        }
        this.overlay.style.display = s === false ? "none" : "block";
    }

};


lnx.audio = {
	
	
	audioPlayer : null,
	flashAudioPlayer : null,
	audioOn : true,
    tOutToken: null,
	period: null,
    delayTimeoutToken: null,
	
	init : function(){
		
		this.setAudioOn( !( lnx.scormApi.getSuspendDataValue ("audio" ) === "false" ));
	
		if( window.Audio ){ 
			this.audioPlayer = new Audio();
            this.audioPlayer.addEventListener("ended", this.onAudioEnd);
		}
		//this.flashAudioPlayer = document.getElementById("flashAudioPlayer");

	},
	
	
	getAudioOn : function(){
		
		return this.audioOn;
	},
	
	
	setAudioOn : function( setOn ){
		
		this.audioOn = setOn;
		lnx.scormApi.setSuspendDataValue("audio", "" + setOn );
	},
	
	
	autoPlayAudio : function( node, screenElm ){
		
		if( !this.audioOn || lnx.config.noAudio){
			return;
		}
		var name;
		if( screenElm && ( name = screenElm.getAttribute( "data-autoAudio" ))){
            if(name === "0") return;
			this.playAudio( name );
		}
	},
	
	
	playAudio : function( name, delay ){
		
        var r = /(\w+)(:)(\w+)/i.exec(name);
        if(r){
            delay = parseFloat(r[3]);
            name = r[1];
        }

        if(name === "0" || !name){
            return;
        }
		
        if(lnx.config.noAudio) return;
		this.stopAudio();

        if(lnx.nav.isLinearNav && lnx.nav.completeAllScreens){
            if(this.period === null){
                this.period = lnx.nav.audioTout;
            }

            if(this.period){            
                this.tOut = setTimeout(this.onAudioEnd, this.period);
            }
        }        
        
		if( !this.audioOn ){
			return;
		}
		if( name === "0" ){
			// placeholder value when no audio file named in xml
			// ie html5 audio player seems to have problem if you feed
			// too many dummy file names to it
			return;
		}
		var suffix = "audio/";
		var prefix = ".mp3";
		var file = suffix + name + prefix;
		if( this.audioPlayer && this.audioPlayer.play){
			
            if(typeof(delay) === "number"){                
                this.delayTimeoutToken = setTimeout(function(){lnx.audio.playAudio(name)}, delay);
                return;      
            }

			//try{
                this.audioPlayer.src = file;
                var p = this.audioPlayer.play();
                if (p !== undefined) {
                    p.catch(function(error) {
                      //console.log("In audio promise catch: " + error);
                    });
                }
                //console.log('just played ' + file);
            // catch( e ){
            //  lnx.util.onError( e, false, "playAudio - html5" );
            // }
		} else {
			
			try {
				this.flashAudioPlayer.playFlashAudio( file );
			}
			catch( e ){
				lnx.util.onError( e, false, "playAudio - flash" );
			}
		}
	},
	
	
	stopAudio : function(){
		if(lnx.config.noAudio) return;
        clearTimeout(this.tOut);
        clearTimeout(this.delayTimeoutToken);
		try {
			if( this.audioPlayer && this.audioPlayer.pause ){
				// html 5 audio in ie9 seems to throw errors when pause function is called depending on audio state
				// testing for audio paused does not prevent following clause from running
				// debugger shows paused value as true when error is generated so following line should not run but does!
				// testing for 'not paused' prevents error but alows audio to continue when it should'nt
				// only seems issue when u rapidly update audio source
				// does not seem to apply to safari
				 if( this.audioPlayer.paused !== true ){
					 this.audioPlayer.pause();
				 }
				
			} else {
				
				this.flashAudioPlayer.stopFlashAudio();
			}
		}
		catch( e ){
			lnx.util.onError( e, false, "stopAudio" );
		}
		
	}, 
    
     onAudioEnd: function(e){
        
        var self = lnx.audio;
        clearTimeout(self.tOut);
        if(lnx.nav.getIsScreenLocked()){
            //return;
        }
        var screen = lnx.view.getCurrentScreen();
        var isVirtual = !!screen.insertVirtualScreen;
        if(isVirtual && screen.waitForUnlock){
            if(screen.waitForUnlock() && !screen.isFinalScreen()){
                return;
            }
	    }
        if(screen.onAudioFinish){
            screen.onAudioFinish();
            return;
        }
	
        lnx.nav.setIsScreenLocked(false);
        lnx.view.onScreenComplete();
        
               
        if(isVirtual && !screen.isFinalScreen()){
            return;
        }          
        lnx.cache.setValue("complete", lnx.nav.getCurrentScreenId(), true);
    }   
	
};


// following objects are the various screen types the app supports
// all screen objects must implement the following interface:

// screen interface:
// obj.init( 
//			 node, - xml toc node
// 			 screenElm, - screen content as html element
//			 frameElm - html element (a div) which parents the screen content 
//	)
// obj.hasContent()
// ojb.destroy( type )



// basic is generally a simple text screen without interactivity
lnx.basic = {
	
	init : function( node, screenElm, frameElm ){
		
	},
	
	hasContent : function(){		
		return false;
	},

	isComplete: function(){
		return true;
	},

    OnNavEventRejectedNotice: function(){
        lnx.view.showUserNoticeGen();
    },
	
	destroy : function( type ){
		
	}	
	
};


lnx.video = {
	
	// bug in ios safari, can't reparent video element
	// use innerHTML to create new video elements
	// reposition single flash object in IE above underlay element 
	init : function( node, screenElm ){
		
		var useHTML5 = lnx.config.useHTML5;
		var vidType = useHTML5 ? ".mp4" : ".swf";
		var vidFolder = "video/";

		var holder = document.getElementById("videoUnderlay");
		var data = holder.getAttribute("data-videoInfo");
		var src = vidFolder + data + vidType;
		var vid;
		
		if( useHTML5 ){
			// create html5 video element
			holder.innerHTML = this.getVideoHTML( data, src );
			vid = holder.firstChild;
			lnx.util.updateEventListener( vid, "play", this.onPlay );

		} else {
			// use existing flash object
			try{
				vid = document.getElementById( "videoPlayer" );
				vid.loadNewMovie(src, false);
			}
			catch( e ){
				lnx.util.onError( e, false, "video - flash" );
			}

			holder.innerHTML = "";
		}
		
		// position video above underlay
		var u = document.getElementById("videoUnderlay")
		vid.style.position = "absolute";
		
		// ie6 and 7 positioning fix - these versions do not correctly calculate offsets consistently
		// only tutorial video effected - temp quick fix
		var ot = u.offsetTop;
		if( data === "tutorial" && lnx.config.isIELessThan8 && (ot < 100) && (!document.querySelectorAll)) {
			ot = 220;
		}
		
		vid.style.top = (ot + "px");
		vid.style.left = (u.offsetLeft + "px");
		vid.className = (data === "tutorial") ? "videoPlayerTutShow" : "videoPlayerShow";

	},
	
	
	onPlay : function( e ){
		
		e = e || window.event;
		var target = e.target || e.srcElement;
		
		lnx.audio.stopAudio();
		
		/*if( target.paused ){
			target.play && target.play();
		} else {
			target.pause && target.pause();
		}*/
					
		e.stopPropagation ? 
		e.stopPropagation() : ( e.cancelBubble = true );
		
		e.preventDefault ?
		e.preventDefault() : ( e.returnValue = false );
		return false;
	},
	
	
	getVideoHTML : function( data, src ){
		
		var poster = "images/" + data + ".jpg"; 
		var iHTML = "<video controls='controls' poster='" + poster + "' type='video/mp4'>";
		iHTML += "<source src='" + src + "' type='video/mp4' />";
		iHTML += "</video>";
		return iHTML;
	},
	
	
	hasContent : function(){
		
		return false;
	},
	
	
	destroy : function(){
		
		var useHTML5 = lnx.config.useHTML5;
		var vid;
		
		try {
			
			if( useHTML5 ){
				vid = document.getElementById("videoUnderlay").firstChild;
				lnx.util.updateEventListener( vid, "play", this.onPlay, true);
			} else {
				vid = document.getElementById("videoPlayer");
				vid.unLoadMovie();
				vid.className = "videoPlayerHide";
			}

		} catch( e ){
			lnx.util.onError( e, false, "video.destroy - useHTML5: " + useHTML5 );
		}
	}
};

lnx.introPanel = {
    
    items : [],
    current : null,
    
    
    init : function( node, screenElm, frameElm ){
        
        this.items = Array.prototype.slice.call(screenElm.querySelectorAll(".hPanel"));

        if( this.items.length ){
            lnx.util.updateEventListener( this.items, "click", this.onSelection);
        }
    },
    
    
    onSelection : function( e ){
            
        e = e || window.event;         
                
        // shortcut ref
        var self = lnx.panel;
        var elm = e.currentTarget;
        
        if(self.current && elm === self.current){
            animate(self.current.querySelector(".panelF"), false);
            elm = null;
        } else {
            animate(elm.querySelector(".panelF"), true);
            self.current && animate(self.current.querySelector(".panelF"), false);
        }
                
        self.current = elm;
                    
        e.stopPropagation ? 
        e.stopPropagation() : ( e.cancelBubble = true );
        
        e.preventDefault ?
        e.preventDefault() : ( e.returnValue = false );
        return false;

        function animate(e, up){
            if(!e) return;
            var tl = new TimelineMax(); 
            if(up){
                //e.style.top = "0px";                
                tl.to(e, .6, {top : "0px"});
            } else {
                //e.style.top = "265px"
                tl.to(e, .6, {top : "265px"});
            }

        }
        
    },
    
    
    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){
        
        lnx.util.updateEventListener( this.items, "click", this.onSelection, true);
        this.current = null;
        this.items = [];
    }
};


lnx.panel = {
	
	items : [],
	current : null,
	
	
	init : function( node, screenElm, frameElm ){
	
		// get nodeList of div elms for traversal
		var set = screenElm.getElementsByTagName("div");
        var tallest = 0, tabs = [];
		
		// collect set of clickable panel elements
		for( var i = 0, len = set.length; i < len; i++ ){
			if( set[i].getAttribute( "data-optionNum" )){
				this.items.push(set[i]);
                tabs.push(set[i].querySelector("div"));
                var h = parseInt(window.getComputedStyle(tabs[tabs.length-1]).height);
                if(h>tallest){
                    tallest = h;
                }
			}
		}
        for( var i = 0; i < tabs.length; i++ ){
            tabs[i].style.height = tallest + "px";
		}
		
		if( this.items.length ){
			lnx.util.updateEventListener( this.items, "click", this.onSelection);
		}
	},
	
	
	onSelection : function( e ){
			
		e = e || window.event;
		var target = e.target || e.srcElement;			
		
		// cater for ie8 lack of currentTarget re bubbling
		var elm, audio, noAudio = false;
		
		if( e.currentTarget ){
			elm = e.currentTarget;
			audio = e.currentTarget.getAttribute("data-audio");
		} else {
			if( !target.getAttribute("data-optionNum") ){
				var t = target.parentNode;
				while( t.parentNode ){
					if( t.getAttribute("data-optionNum") ){
						elm = t;
						audio = t.getAttribute("data-audio");
						break;
					}
					t = t.parentNode;
				}
			} else {
				elm = target;
				audio = target.getAttribute("data-audio");
			}
		}
		
		// shortcut ref
		var self = lnx.panel;
		
		// multiple classes per className
		// workaround for lack of classList property in IE
		var child;
		if( self.current && self.current === elm  ){
			// toggle current items display
			child = self.current.getElementsByTagName("p")[1];
			if( /hide/.test( child.className )){
				child.className =
					child.className.replace(/hide/, "show");
			} else {
				child.className =
					child.className.replace(/show/, "hide");
				noAudio = true;
			}
			
		} else {
			// show new selection and hide (possible) previous selection
			elm.getElementsByTagName("p")[1].className = 
				elm.getElementsByTagName("p")[1].className.replace(/hide/, "show");
			if( self.current ){
				self.current.getElementsByTagName("p")[1].className =
					self.current.getElementsByTagName("p")[1].className.replace(/show/, "hide");
			}				
		}
		
		// only play audio if new item clicked
		// stop audio if existing selection is reselected 'off'
		if ( noAudio ){
			//lnx.audio.stopAudio(); //no panel audio in this course so let main audio finish 
		} else if( audio ){
			//lnx.audio.playAudio(audio);
		}
		
		self.current = elm;
					
		e.stopPropagation ? 
		e.stopPropagation() : ( e.cancelBubble = true );
		
		e.preventDefault ?
		e.preventDefault() : ( e.returnValue = false );
		return false;
		
	},
	
	
	hasContent : function(){
		
		return false;
	},
	
	
	destroy : function(){
		
		lnx.util.updateEventListener( this.items, "click", this.onSelection, true);
		this.current = null;
		this.items = [];
	}
};



lnx.accordian = {
	
	items : [],
	current : null,
	
	
	init : function( node, screenElm, frameElm ){
	
		// get nodeList of div elms for traversal
		var set = screenElm.querySelectorAll("div.clickable");
		
		// collect clickable div lems
		for( var i = 0, len = set.length; i < len; i++ ){
			if( set[i].getAttribute( "data-optionNum" )){
				this.items.push(set[i]);
			}
		}
		
		if( this.items.length ){
			lnx.util.updateEventListener( this.items, "click", this.onSelection);
		}
	},
	
	
	onSelection : function( e ){
			
		e = e || window.event;
		var target = e.target || e.srcElement;
				
		// cater for ie8 lack of currentTarget re bubbling
		var elm;
		if( e.currentTarget ){
			elm = e.currentTarget;
		} else {
			if( !target.getAttribute("data-optionNum") ){
				var t = target.parentNode;
				while( t.parentNode ){
					if( t.getAttribute("data-optionNum") ){
						elm = t;
						break;
					}
					t = t.parentNode;
				}
			} else {
				elm = target;
			}
		}
		
		// shortcut ref
		var self = lnx.accordian;
		
		var info;
		
		// multiple classes per className
		// following is workaround for lack of classList property
		if( self.current && self.current === elm  ){
			// toggle current items display
			info = self.current.querySelector("div:nth-of-type(2)");
			if( /hide/.test( info.className )){
				info.className =
					info.className.replace(/hide/, "show");
			} else {
				info.className =
					info.className.replace(/show/, "hide");
			}
		} else {
			// show new selection and hide (possible) previous selection
            info = elm.querySelector("div:nth-of-type(2)");
			info.className = info.className.replace(/hide/, "show");
			if( self.current){
                info = self.current.querySelector("div:nth-of-type(2)");
				info.className =info.className.replace(/show/, "hide");
			}				
		}
		
		self.current = elm;
					
		e.stopPropagation ? 
		e.stopPropagation() : ( e.cancelBubble = true );
		
		e.preventDefault ?
		e.preventDefault() : ( e.returnValue = false );
		return false;
		
	},
	
	
	hasContent : function(){
		
		return false;
	},
	
	
	destroy : function(){
		
		lnx.util.updateEventListener( this.items, "click", this.onSelection, true);
		this.current = null;
		this.items = [];
	}
};


lnx.scenario = {
	
	options : [],
	isSubtype : false,
	screenElm : null,
	
	
	init : function( node, screenElm, frameElm ){
		
		// store whether scenario is subtype or not
		this.isSubtype = !!node.getAttribute( "subType" );
		
		// store a reference to the screen's parent html element for use in event handler
		this.screenElm = screenElm;
	
		// get nodeList of div elms for traversal
		var set = screenElm.getElementsByTagName("div");
		
		// collect set of scenario options - options have data-optionNum attribute
		for( var i = 0, len = set.length; i < len; i++ ){
			if( set[i].getAttribute("data-optionNum") ){
				this.options.push(set[i]);
			}
		}
		
		if( this.options.length ){
			lnx.util.updateEventListener( this.options, "click", this.onSelection);
		}
	},
	
	
	onSelection : function( e ){
			
		e = e || window.event;
		var target = e.target || e.srcElement;
		
		// ref to host object
		var self = lnx.scenario;

		// cater for ie8 which has no currentTarget re bubbling
		var opt, audio, t;
		
		if( e.currentTarget ){
			opt = e.currentTarget.getAttribute("data-optionNum");
			audio = e.currentTarget.getAttribute("data-audio");
		} else {
			opt = target.getAttribute("data-optionNum");
			if( !opt ){
				t = target.parentNode;
				while( t.parentNode ){
					if( opt = t.getAttribute("data-optionNum")){
						audio = t.getAttribute("data-audio");
						break;
					}
					t = t.parentNode;
				}
			} else {
				audio = target.getAttribute("data-audio");
			}							
		}
			
		opt = parseInt(opt, 10);
		
		// we have 2 types of scenario
		// TO DO: clear out magic strings
		if( self.isSubtype ){
			
			var elm2, elm = document.getElementById("cs_1_left_txt");
			var img = document.getElementById("csImg");
			img.src = self.screenElm.getAttribute("data-image2");
			
			if( opt === 1 ){
				elm2 = document.getElementById("cs_2_a");
				elm.innerHTML = elm2.innerHTML;	
			} else if( opt === 2 ){
				elm2 = document.getElementById("cs_2_b");
				elm.innerHTML = elm2.innerHTML;	
			} else if( opt === 3 ){
				elm2 = document.getElementById("cs_2_c");
				elm.innerHTML = elm2.innerHTML;	
			}
			
		} else {
			
			if( opt >= 1 && opt <= 4){
				document.getElementById("cs_1").className = "hide";
				document.getElementById("cs_2").className = "show";
			} else if(opt == 5){
				document.getElementById("cs_2_right_1").className = "show";
				document.getElementById("cs_2_right_2").className = "hide";
			} else if(opt == 6){
				document.getElementById("cs_2_right_2").className = "show";
				document.getElementById("cs_2_right_1").className = "hide";
			}
		}

		
		if( audio ){
			lnx.audio.playAudio(audio);
		}
		
		e.stopPropagation ? 
		e.stopPropagation() : ( e.cancelBubble = true );
		
		e.preventDefault ?
		e.preventDefault() : ( e.returnValue = false );
		return false;
		
	},
	
	
	hasContent : function(){
		
		return false;
	},
	
	
	destroy : function( type ){
		
		lnx.util.updateEventListener( this.options, "click", this.onSelection, true);
		this.options = [];
		this.isSubtype = false;
		this.screenElm = null;
	}
};


lnx.slideShow = {
	
	thumbs : [],
	current : null,
	active : false,
	useHTML5 : false,
	
	init : function( node, screenElm ){
		
		this.useHTML5 = lnx.config.useHTML5;
				
		// get nodeList of img elms for traversal
		var vset = lnx.util.getElmsByTagAndAttrib(screenElm, "img", "data-thumbs");
		
		// collect set of thumbnails
		for( var i = 0, len = vset.length; i < len; i++ ){
			this.thumbs.push(vset[i]);
		}

		if( this.thumbs.length ){
			lnx.util.updateEventListener( this.thumbs, "click", this.onClick);
			lnx.util.updateEventListener( this.thumbs, "mouseover", this.onMouseOver);
			lnx.util.updateEventListener( this.thumbs, "mouseout", this.onMouseOut);
		}

	},
	
	
	onClick : function( e ){
			
		e = e || window.event;
		var target = e.target || e.srcElement;
					
		lnx.audio.stopAudio();
		
		if( lnx.slideShow.current === target ){	
			// replay movie
		} else {
			
			target.src = target.getAttribute("data-down");
			lnx.slideShow.current = target;
			var tmbs = lnx.slideShow.thumbs;
			
			// ie8 has no nextElementSibling but nextSibling selects text nodes in ie9
			var nextElementSibling = (target.nextElementSibling !== undefined) ? "nextElementSibling" : "nextSibling";
			
			for( var i = 0, len = tmbs.length; i < len; i++ ){
				
				if( tmbs[i] !== target ){
					// display thumbnail in up state
					tmbs[i].src = tmbs[i].getAttribute("data-up");				
					var sib = tmbs[i][nextElementSibling];
					if( sib  && sib.tagName.toLowerCase() === "p"){
						sib.className = "ssThumbTitle";
					}
													
				} else {
					// display thumbnail in down state
					var sib = tmbs[i][nextElementSibling];
					if( sib  && sib.tagName.toLowerCase() === "p"){
						sib.className = "ssThumbTitleOn";
					}
					// hide placeholder image where video displays
					var img = document.getElementById("ssInitImg");
					img && (img.style.display = "none");
					// display video	
					lnx.slideShow.displayVideo( tmbs[i].getAttribute("data-targetVid") );	
				}
			}
		}	
					
	
		e.stopPropagation ? 
		e.stopPropagation() : ( e.cancelBubble = true );
		
		e.preventDefault ?
		e.preventDefault() : ( e.returnValue = false );
		return false;
		
	},
	
	onMouseOver : function( e ){
		
		e = e || window.event;
		var target = e.target || e.srcElement;
			
			
		if( lnx.slideShow.current !== target ){	
			target.src = target.getAttribute("data-roll");
		}
		
		e.stopPropagation ? 
		e.stopPropagation() : ( e.cancelBubble = true );
		
		e.preventDefault ?
		e.preventDefault() : ( e.returnValue = false );
		return false;
		
	},
	
	onMouseOut : function( e ){
		
		e = e || window.event;
		var target = e.target || e.srcElement;
			
			
		if( lnx.slideShow.current !== target ){	
			target.src = target.getAttribute("data-up");
		}
		
		e.stopPropagation ? 
		e.stopPropagation() : ( e.cancelBubble = true );
		
		e.preventDefault ?
		e.preventDefault() : ( e.returnValue = false );
		return false;
	},
	
	
	getVideoHTML : function( data, src ){

		var poster = "images/" + data + ".jpg"; 
		var iHTML = "<video controls='controls' poster='" + poster + "' type='video/mp4'>";
		iHTML += "<source src='" + src + "' type='video/mp4' />";
		iHTML += "</video>";
		return iHTML;
	},
	
	
	displayVideo : function( data ){
		
		var vid;
		var vidType = this.useHTML5 ? ".mp4" : ".swf";
		var vidFolder = "video/";
		var src = vidFolder + data + vidType;
		
		var holder = document.getElementById("videoUnderlay");
		
		if( this.useHTML5 ){
			
			holder.innerHTML = this.getVideoHTML( data, src );
			holder.style.display = "block";
			vid = holder.firstChild;
			vid.className = "videoPlayerSSShow";
			vid.play();
			
		} else {
			// diplay flash object and load flash movie
			holder.innerHTML = "";
			holder.style.display = "block";
			vid = document.getElementById("videoPlayer");
			vid.className = "videoPlayerSSShow";
			try{
				vid.loadNewMovie(src, true);
			}catch( e ){
				lnx.util.onError( e, false, "slideShow - flash" );
			}
			
			// position flash object above underlay
			vid.style.position = "absolute";
			var u = document.getElementById("videoUnderlay");
			
			// ie6 and 7 positioning fix - these versions do not correctly calculate offsets consistently
			//  - temp quick fix
			var ot = u.offsetTop;
			var ol = u.offsetLeft;
			if( lnx.config.isIELessThan8 && (ot < 100) && (!document.querySelectorAll)){
				ot = 220;
				ol = 410;
			}
			
			vid.style.top = (ot + "px");
			vid.style.left = (ol + "px");
			vid.className = "videoPlayerSSShow";
			this.active = true;
		}
							
		
	},
	
	
	hasContent : function(){
		
		return false;
	},
	
	
	destroy : function(){
		
		lnx.util.updateEventListener( this.thumbs, "click", this.onClick, true);
		lnx.util.updateEventListener( this.thumbs, "mouseover", this.onMouseOver, true);
		lnx.util.updateEventListener( this.thumbs, "mouseout", this.onMouseOut, true);
		
		if( this.active ){

			try{
				var vid = document.getElementById("videoPlayer");
				vid.unLoadMovie();				
				vid.className = "videoPlayerHide";
			}
			catch( e ){
				
				lnx.util.onError(e, false, "slideShow.destroy - flash");	
			}
		}
		
		this.active = false;
		this.current = null;
		this.useHTML5 = false;
		this.thumbs = [];
		
	}
};

lnx.assessment = {
    
    questionObjects: null,
    passScore: 8,
    retakeId: null,
    testContainer: null,
    circles: null,
    totalQnum: null,
    questionNum: null,
    results: {
        pass: false,
        complete: [],
        retake: []
    },
    interactionsCount: null,
    
    init : function(node, screenElm, frameElm){

        if(this.interactionsCount === null){
            this.interactionsCount = parseInt(lnx.scormApi.lmsGet(lnx.scormApi.CMI.INTERACTIONS_COUNT));
            if(isNaN(parseInt(this.interactionsCount))){
                this.interactionsCount = 0;
            }
        }

        var self = this;  
        this.questionNum = 1;      
        console.log('init assess');
        // if(!lnx.scormApi.getIsCourseComplete()){
            lnx.nav.takingTest(true);
        // }
        
        var passScr = parseInt(screenElm.getAttribute("data-passScore"), 10);
        if( !isNaN( passScr )){
            this.passScore = passScr;
        }            
        this.retakeId = screenElm.getAttribute("data-retakeId");
        this.testContainer = document.querySelector("div.testContainer");

        if(this.results.pass){
            this.results = resetResultsObj();
        }
        this.questionObjects = this.populateQuestionObjects(this.results.complete);
        this.circles = initCircles(this.questionObjects.length);      
        this.changeDotState(this.results.complete, true);
        

        function initCircles(num){
            var container = document.querySelector("div.questionsProgress");
            var s = "";
            for(var i=1; i < num + 1; i++){
                s +=  "<div>" + i + "</div>";
            }
            container.innerHTML = s;
            return container.childNodes;
        }

        function resetResultsObj(){
            return {
                pass: false,
                complete: [],
                retake: []
            }
        }
    },

    changeDotState: function(num, off){
        var self = this;
        if(typeof num === "number"){
            if(self.results.retake.length){
                num = useAsIndex(num);
            }
            num = [num];
        }
        if(off){
            value = .25;
        }
        for(var i=0;i<num.length;i++){
            this.circles[num[i]].style.opacity = value;
        }

        function useAsIndex(i){            
            return self.results.retake[i];
        }
    },

    hasContent : function(){
        return false;
    },

    populateQuestionObjects: function(ignore){

        ignore = ignore || [];
        var qs = this.testContainer.querySelectorAll("div.questionScreen");
        this.totalQnum = qs.length;
        var qObjects = this.questionObjects || [];
        var isSubmitObj;

        for(var i=0; i<qs.length;i++){
            if(!ignore.includes(i)){
                var t = Object.create(this.questionObject);
                t.init(qs[i], this, i);
                qObjects[i] = t;
                isSubmitObj = i;
            } else {
                qObjects[i].legacy = true;
                qs[i].style.display = "none";
            }
        }
        qObjects[isSubmitObj].setAsSubmit();
        return qObjects;
    },


    updateVirtualScreen: function(dir){        
        
        var self = this;
        var inc = -1;
        var dx = "+=58.125rem";

        if(dir === "next"){
            inc = 1;
            dx = "-=58.125rem"
        }
        
        this.questionNum += inc;        
        slidePanel(dx, 1.2);
        
         function slidePanel(val, time){
            var tl = new TimelineMax();
            tl.to(self.testContainer, time, {x : val});
        }        
    },

    insertVirtualScreen: function(dir){
        
        if(dir === "next"){
            if(this.questionNum < this.totalQnum){
                this.changeDotState(this.questionNum - 1, true);
                this.updateVirtualScreen(dir);                
                return true;
            } else {
                return false;
            }
        } else if(this.questionNum <= 1){                
            return false;
        } else {
            this.updateVirtualScreen(dir);
            return true;
        }        
    },

    onQuestionComplete: function(){
        this.insertVirtualScreen("next");
    },

    onSubmit: function(){

        var r = this.calcResult();
        //this.updateVirtualScreen("next");
        lnx.nav.takingTest(false);
        lnx.nav.onTestResult(r.pass);
    },

    calcResult: function(){

        var r = this.results;
        r.complete = [];
        r.retake = [];
        var qs = this.questionObjects;

        for(var i=0;i<qs.length;i++){
            // if(!qs[i].legacy){
                if(qs[i].isCorrect){
                    r.complete.push(i);
                } else {
                    r.retake.push(i);
                }      
            // }            
        }

        if(r.complete.length >= this.passScore){
            r.pass = true;
        }
        // console.log(r);
        // console.log(qs);
        
        return r;
    },

    getStatus: function(){
        if(!this.results.complete.length && !this.results.retake.length){
            return 0;
        } else if(this.results.pass){
            return 1;
        } else {
            return 2;
        }
    },

    retake : function(){        
        lnx.nav.onRetakeTest(this.retakeId);
    },

    getResults: function(){
        return this.questionObjects;
    },
    
    destroy: function(){
        console.log("destroy: calling takingTest(false)");
        lnx.nav.takingTest(false);
    },   
    
    // called on page close to release resources held in doc fragment
    fullDestroy : function(){
        
    }    
};

lnx.assessment.questionObject = {

    qId: null,
    corAnswer: null,
    isRadio: true,
    answered: false,
    qElm: null,
    answers: [],
    correct: false,
    parent: null,
    htmlStore: null,

    init: function(e, p, i){
        var self = this;
        this.parent = p;
        this.qElm = e;
        this.qId = e.getAttribute("id");
        this.index = 
        this.corAnswer = e.getAttribute("data-correctAns").split(",");
        this.isRadio = this.corAnswer.length == 1;
        this.optionsInt = Array.prototype.slice.call(e.querySelectorAll("div.qOption"));        
        this.btn = e.querySelector("button.qButton");
        this.activated = false;
        this.selected = [];
        this.isCorrect = null;
        this.userAns = null;
        this.question = e.querySelector("div.quesText").outerHTML;
        this.options = getOptionsHTML();
        this.feedback = e.querySelector("div.feedback").innerHTML;

        lnx.util.updateEventListener(this.optionsInt, "click", this.onSelect.bind(this));
        lnx.util.updateEventListener(this.btn, "click", this.onBtnClick.bind(this));

        function getOptionsHTML(){
            var a = [];
            var t = e.querySelectorAll("div.qOption");
            for(var i=0;i<t.length;i++){
                var ps = t[i].querySelectorAll("p");
                var s = "";
                for(var k=0; k < ps.length;k++){
                    s += ps[k].innerHTML + " ";
                }
                a[i] = s;
            }
            return a;
        }
    },

    setAsSubmit: function(){
        var s = lnx.localization.getLocalString("s11"); //submit
        if(this.btn.getAttribute("data-btnVal") !== "submit"){
            this.btn.setAttribute("data-btnVal", "submit");
            this.btn.innerHTML = s;
        }
    },

    markQuestion: function(){
        var s = this.selected.sort();
        var c = this.corAnswer.sort().slice();
        var r = true;
        var uas = [];
        var op = this.optionsInt;
        var res = true;
        var self = this;

        for(var i=0; i<s.length; i++){
            var ua = {num: s[i] - 1, isCorrect: false};
            if(c.includes(s[i])){
                ua.isCorrect = true;
                c.splice(c.indexOf(s[i]), 1);
            } else {
                res = false;
            }
            uas.push(ua);
        }
        if(c.length){
            res = false;
        }
        
        this.isCorrect = res;
        this.userAns = uas;      
        
        if(!lnx.scormApi.getIsCourseComplete()){
            updateScormApi();
        }        

        return r;

        function updateScormApi(){
            var n = self.parent.interactionsCount;
            lnx.scormApi.lmsSet(lnx.scormApi.CMI.INTERACTIONS_ID, self.qId ,n);
            lnx.scormApi.lmsSet(lnx.scormApi.CMI.INTERACTIONS_TYPE, "choice", n);
            lnx.scormApi.lmsSet(lnx.scormApi.CMI.INTERACTIONS_COR_RESP, self.corAnswer.sort().join(), n);
            lnx.scormApi.lmsSet(lnx.scormApi.CMI.INTERACTIONS_STU_RESP, s.join(), n);
            lnx.scormApi.lmsSet(lnx.scormApi.CMI.INTERACTIONS_RESULT, (res ? "correct" : "wrong"), n);
            //lnx.scormApi.lmsSet(lnx.scormApi.CMI.INTERACTIONS_TIME, ,n);    
            self.parent.interactionsCount++;    
        }
    },

    reset: function(){

    },

    onSelect: function(e){
        
        var self = this;

        if(!this.activated){
            this.btn.classList.add("qBtnAvailable");
            this.activated = true;
        }

        var opt = e.currentTarget;
        var optNum = opt.getAttribute("data-optNum");
        if(this.isRadio){
            setRadioState(opt);
        } else {
            if(removeOrAdd(optNum)){
                opt.classList.toggle("qOptionSelected");
            }            
        }

        function setRadioState(o){
           
            if(!self.selected.length){
                self.selected[0] = optNum;
                o.classList.toggle("qOptionSelected");
            } else {
                var t = getOptionElm(self.selected[0]);
                t.classList.toggle("qOptionSelected");
                self.selected[0] = optNum;
                o.classList.toggle("qOptionSelected");
            }
        }

        function getOptionElm(n){
            return self.optionsInt[parseInt(n) - 1];
        }       

        function removeOrAdd(n){
            var s = self.selected;
            var i = s.indexOf(n);
            if(i !== -1 && s.length === 1){
                //nothing to do
                return false;
            } 
            if(i === -1){
                s.push(n);
            } else {
                s.splice(i, 1);
            }
            return true;      
        }
    },

    onBtnClick: function(e){
        if(!this.activated){
            return;
        }
        var ct = e.currentTarget;        
        var v = ct.getAttribute("data-btnVal").toLowerCase();
        this.markQuestion();
        if(v === "next"){          
            this.parent.onQuestionComplete();
        } else if(v === "submit"){
            this.parent.onSubmit();
        } else {
            console.log("error in onSelect");
        }       
    }
};

lnx.assessmentIntro = {
    
    resourceId : null,
    
    init : function( node, screenElm, frameElm ){
        
        this.resourceId = screenElm.getAttribute("data-resourceId");
        var elm = document.getElementById(this.resourceId);
        elm && (elm.value = lnx.localization.getLocalString("s10")); // Knowledge Check
        
        if( this.resourceId ){
            lnx.util.updateEventListener( elm, "click", this.onStartTest );
        } else {
            lnx.util.onError("Failed to find resourceId in lnx.assessmentIntro.init");
        }
        
        return this;
            
    },
    
    onStartTest : function(){
        
        lnx.nav.next();
    },
    
    hasContent : function(){
        
        return false;
    },
    
    destroy : function( type ){
        
        if( this.resourceId ){
            lnx.util.updateEventListener( 
                document.getElementById(this.resourceId),
                "click", 
                this.onStartTest, true
            );
        }
    }   
    
};



lnx.assessmentFeedback = {
    
    fbAudioIds : null,
    retakeBtn : null,
    fbItems : null,
    curFbItem : null,
    
    
    init : function( node, screenElm, frameElm ){
        
        var helper = lnx.assessment;
        lnx.nav.takingTest(true);
        
        if( !this.fbAudioIds ){
            this.fbAudioIds = [];
            // note order of audio ids is important for setDisplay()
            this.fbAudioIds.push(screenElm.getAttribute( "data-audioNoResults" ));
            this.fbAudioIds.push(screenElm.getAttribute( "data-audioCorrect" ));
            this.fbAudioIds.push(screenElm.getAttribute( "data-audioIncorrect" ));
        }
        
        this.retakeBtn = document.getElementById("retakeBtn");
        this.retakeBtn && (this.retakeBtn.value = lnx.localization.getLocalString("s12"));
        
        var elms = [];
        for( var i = 0; i < 3; i++ ){
            // feedback0: TEST_INCOMPLETE, feedback1: TEST_PASS, feedback2: TEST_FAIL,
            elms.push(document.getElementById("feedback" + i));
        }
        
        this.setDisplay( elms, helper.getStatus(), this.fbAudioIds );
                
        lnx.util.updateEventListener( this.retakeBtn, "click", this.onRetake );
                
    },
    
    
    // display 1 of 3 feeback alternatives depending on assessment status
    setDisplay : function( elms, status, audioIds ){
 
        // status values:   
        // 0 - TEST_INCOMPLETE, 1 - TEST_PASS, 2 - TEST_FAIL        
        for( var j = 0; j < 3; j++ ){
            if( j == status ){
                elms[j].className = "show";
                 if(audioIds[j]) lnx.audio.playAudio(audioIds[j]);
                break;
            } 
        }
        if( status ){
            // only show results when test taken, eg status value of 1 or 2
            try{
                this.showResults();
            } catch(e){
                // can ignore errors here if user clicks forward before completing some questions
                lnx.util.log(e);
            }            
            if(status === 1){
                //override disable nav btns functionality by calling on next tick
               setTimeout(function(){lnx.view.enableNavButtonFwdState();},0);
            }
        }
                
    },
    
    onRetake : function( e ){
        
        e = e || window.event;
        var target = e.target || e.srcElement;
        var helper = lnx.assessment;
        var self = lnx.assessmentFeedback;
        
        //self.clearResults();
        //helper.doReset();
        helper.retake();
        
        e.stopPropagation ? 
        e.stopPropagation() : ( e.cancelBubble = true );
    },
    
    
    
    /*clearResults : function(){
        
        this.curFbItem = null;
        lnx.view.clearScreenFrame();
    },*/
    
    
    showResults : function(){
        
        this.fbItems = [];
        var iHTML = "";     
        var results = lnx.assessment.getResults();
        
        for( var i = 0, len = results.length; i < len; i++ ){
            
            var num = i + 1;
            var img = results[i].isCorrect ? "src='images/knowledgecheck_tick.gif'" : "src='images/knowledgecheck_cross.gif'";
        
            iHTML += "<div data-result='true' class='qResult' data-optionNum='" + num + "'><img " + img + " class='imgBlock' \/><span class='fQuestionTitle'>" + lnx.localization.getLocalString( "s4" ) + " " + num + "</span><img class='arRightAngle' src='images/rightAngle.svg'/></div>";
            iHTML += "<div class='hide qFeedback'><p class='fbQuestion'>" + results[i].question + "</p>";
            iHTML += "<div class='fOptions'>";
            
            var o = results[i].options;
            for( var j = 0, k = o.length; j < k; j++ ){
                
                var style = "";
                
                for(var m = 0; m < results[i].userAns.length; m++){
                    var ua = results[i].userAns[m];
                    if( ua.num === j){
                        style = ua.isCorrect ? " class='userAnsGreen'" : " class='userAnsRed'";                     
                    }                   
                }               
                
                // put space between option number and option text
                var txt = o[j].replace(/(.\.)/, "$1&nbsp;|&nbsp;&nbsp;");
                iHTML += "<div" + style + ">" + o[j] + "</div>";
                    
            }
            iHTML += "</div>";
            
            //var fb = results[i].isCorrect ? "That's correct!" : "That's incorrect!";
            var fb = results[i].isCorrect ? lnx.localization.getLocalString( "s6" ) : lnx.localization.getLocalString( "s7" );
            //iHTML += "<p class='fbHeading'>Feedback: " + fb + "</p>";
            iHTML += "<p class='fbHeading'>" + lnx.localization.getLocalString( "s8" ) + "&nbsp;" + fb + "</p>";
            if(!(results[i].feedback === "<hr class=\"hr1px\">" || results[i].feedback === ".")){
                iHTML += "<div class='fbTxt'>" + results[i].feedback + "</div>";
            }
            iHTML += "</div>";       
        }       
        
        
        var container = document.getElementById("fbResultsContainer");
        container.innerHTML = iHTML;

        // cater for ie6, can't use querySelectorAll
        var set = lnx.util.getElmsByTagAndAttrib(container, "div", "data-result");
        
        
        for( i = 0, len = set.length; i < len; i++ ){
            this.fbItems.push(set[i]);
        }
        
        if( this.fbItems.length ){
            lnx.util.updateEventListener( this.fbItems, "click", this.onClick);
        }
        
    },
    
    

    onClick : function( e ){
            
        e = e || window.event;
        var target = e.target || e.srcElement;
        var self = lnx.assessmentFeedback;
        
        var elm;
        if( e.currentTarget ){
            elm = e.currentTarget;
        } else {
            if( !target.getAttribute("data-optionNum") ){
                var t = target.parentNode;
                while( t.parentNode ){
                    if( t.getAttribute("data-optionNum") ){
                        elm = t;
                        break;
                    }
                    t = t.parentNode;
                }
            } else {
                elm = target;
            }
        }
        
        // ie8 has no nextElementSibling but nextSibling selects text nodes in ie9
        var nextElementSibling = (elm.nextElementSibling !== undefined) ? "nextElementSibling" : "nextSibling";
        
        // may be multiple classes per className
        // following is workaround for lack of classList property
        if( self.curFbItem && self.curFbItem === elm  ){
            // toggle current items display
            var sib = self.curFbItem[nextElementSibling];
            /*if( !sib ){
                lnx.util.onError("No nextElementSibling in showResults");
            }*/
            if( /hide/.test( sib.className )){
                sib.className =
                    sib.className.replace(/hide/, "show");
                // play audio feedback
                //lnx.audio.playAudio( elm.getAttribute( "data-audio" )); // no audio feedback in this course
            } else {
                sib.className =
                    sib.className.replace(/show/, "hide");
                // closed item so stop audio feedback
                //lnx.audio.stopAudio(); // no audio feedback in this course
            }
        } else {
            // show new selection and hide (possible) previous selection
            elm[nextElementSibling].className = 
                elm[nextElementSibling].className.replace(/hide/, "show");
            // play audio feedback
            //lnx.audio.playAudio( elm.getAttribute( "data-audio" )); // no audio feedback in this course
            
            if( self.curFbItem && self.curFbItem[nextElementSibling] ){
                self.curFbItem[nextElementSibling].className =
                    self.curFbItem[nextElementSibling].className.replace(/show/, "hide");
            }               
        }
        
        self.curFbItem = elm;
        
        e.stopPropagation ? 
        e.stopPropagation() : ( e.cancelBubble = true );
        
        e.preventDefault ?
        e.preventDefault() : ( e.returnValue = false );
        return false;
        
    },
    
    
    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function( type ){
        lnx.nav.takingTest(false);
        if( this.retakeBtn ){
            lnx.util.updateEventListener( this.retakeBtn, "click", this.onRetake, true );
            this.retakeBtn = null;
        }
        if( this.fbItems ){
            lnx.util.updateEventListener( this.fbItems, "click", this.onClick, true);
            this.fbItems = null;
        }
        
        this.curFbItem = null;
    }
    
    
};

lnx.survey = {

    uploadEnabled: false,

    init : function( node, screenElm, frameElm ){

        lnx.nav.takingTest(true);
        this.isR2L = window.getComputedStyle(document.querySelector('html')).direction === "rtl";
        this.surveyQuestions = Array.from(screenElm.querySelectorAll(".questionScreen"));
        this.surveyOptions = Array.from(screenElm.querySelectorAll(".surveyOptions"));	
        this.stars = Array.from(screenElm.querySelectorAll(".dStar"));
        lnx.util.updateEventListener(this.stars, "mouseenter", this.onEnterStar.bind(this));
        lnx.util.updateEventListener(this.stars, "mouseleave", this.onLeaveStar.bind(this));
        lnx.util.updateEventListener(this.stars, "click", this.onSelectStar.bind(this));
        var ta = Array.from(screenElm.querySelectorAll("textarea"));
        ta.forEach((a,i) => {if(ta[i].textContent === "."){ta[i].textContent = "";}});
        this.submitBtn = screenElm.querySelector("button.surveySubmit");
        this.uploadInstruction = screenElm.querySelector(".uploadInstruction");
        lnx.util.updateEventListener(this.surveyOptions, "click", this.onSelect.bind(this));
        lnx.util.updateEventListener(this.submitBtn, "click", this.onSubmit.bind(this));
	},

    onEnterStar: function(e){
        var t = e.currentTarget;
        var p = t.parentNode;
        var starChange = true;
        if(p.getAttribute("data-selectedoption")){
            starChange = false;
        }
        var x = p.parentNode.querySelectorAll(".starLabelOptions p");
        var r = [.75,3.5,6,8.25,11.5];
        
        var s = p.querySelectorAll(".dStar");
        for(var i=0;i<s.length;i++){
            if(starChange){
                s[i].querySelector(".svStar").style.fill = "#ffd70088";
            }            
            if(s[i] === t){
                x[i].style.visibility = "visible";
                x[i].style.transform = `translateX(calc(${r[i]}rem - 50%))`;
                if(this.isR2L){
                    x[i].style.transform = `translateX(calc(${-r[i]}rem + 50%))`;
                }
                break;
            }
        }
    },

    onLeaveStar: function(e){
        var t = e.currentTarget;
        var p = t.parentNode;
        var starChange = true;
        if(p.getAttribute("data-selectedoption")){
            starChange = false;
        }
        var x = p.parentNode.querySelectorAll(".starLabelOptions p");
        var s = p.querySelectorAll(".dStar");
        for(var i=0;i<s.length;i++){
            if(starChange){
                s[i].querySelector(".svStar").style.fill = "transparent";
            }
            x[i].style.visibility = "hidden";
        }
    },

    onSelectStar: function(e){
        var allset = false;
        var t = e.currentTarget;
        var p = t.parentNode;        
        var s = p.querySelectorAll(".dStar");
        
        for(var i=0;i<s.length;i++){
            s[i].querySelector(".svStar").style.fill = "transparent";
            s[i].querySelector(".svStar").style.stroke = "#000";
            s[i].querySelector(".svStar").style.strokeWidth = "1";
            // x[i].style.color = "#000";
            // x[i].style.backgroundColor = "transparent";
            if(!allset){
                s[i].querySelector(".svStar").style.fill = "#ffd700";
                s[i].querySelector(".svStar").style.stroke = "#ffd700";
                s[i].querySelector(".svStar").style.strokeWidth = "2";                
                if(s[i] === t){
                    // x[i].style.color = "#fff";
                    // x[i].style.backgroundColor = "#38424c";                    
                    p.setAttribute("data-selectedoption", `${i+1}`);
                    allset = true;
                }
            }
        }
    },

    onSelect: function(e){
        var elm;
        var self = this;
        var tg = e.target;
        if(!tg.getAttribute("data-optNum")){
            var t = tg.parentNode;
            while(t.parentNode){
                if(t.getAttribute("data-optNum")){
                    elm = t;
                    break;
                }
                t = t.parentNode;
            }
        } else {
            elm = tg;
        }
        if(elm){
            var c = e.currentTarget.childNodes;
            c.forEach((a,i)=>{
                if(c[i] === elm){
                    e.currentTarget.setAttribute("data-selectedoption", `${i+1}`);
                    c[i].classList.add("surveyOptionSelected");
                } else {
                    c[i].classList.remove("surveyOptionSelected");
                }
            });           
        }

        if(!this.uploadEnabled){
            checkForCompletion();
        }
        

        function checkForCompletion(){           
            var complete = true;
            // self.surveyOptions.forEach((a,i)=>{
            //     if(!self.surveyOptions[i].getAttribute("data-selectedoption")){
            //         complete = false;
            //     }
            // });
            if(complete){
                self.submitBtn.removeAttribute("disabled");
                self.uploadInstruction.classList.add("makeVisible");
                self.uploadEnabled = true;
            }
        }
    },

    onSubmit: function(e){
        var q = this.surveyQuestions;
        var r = [];
        for(var i=0;i<q.length;i++){
            var o = {};
            o.questionId = `${i+1}`;
            var so = q[i].querySelector("div.starContainer");
            if(so){
                o.questionFeedback = so.getAttribute("data-selectedoption") || "";
            } else {
                o.questionFeedback = q[i].querySelector("textarea").value;
            }
            r.push(o);
        }
        lnx.scormApi.lmsCompleteSurvey(r, e.shiftKey);
    },
	
	hasContent : function(){		
		return false;
	},

	isComplete: function(){
		return true;
	},
	
	destroy : function( type ){
		
	}	
};


lnx.multiPanel = {
    
    items : [],

    init : function( node, screenElm, frameElm ){ 
        
        var params = JSON.parse(screenElm.getAttribute("data-params"));
        var scrId = screenElm.getAttribute("id");
        //console.log(params);
        var p = screenElm.querySelectorAll(".panelsHolder > div");
        var o = screenElm.querySelectorAll(".panelsOverlayHolder > div > div");
        var c = screenElm.querySelectorAll(".panelsOverlayHolder > div");
        var num = p.length;
        var targets = [];
        var isComplete = false;
        var inCompleteList = [];

        setStyles(p, params);

        for(i=0;i<num;i++){  
            var obj = {closed:false, animHeight:false, 
                value:null, panel:null, overlay:null, container:null};
            if(p[i].getAttribute("data-animHeight") === "true"){
                obj.animHeight = true;
                obj.value = window.getComputedStyle(c[i]).height;
                c[i].style.height = "0px";
            } else {
                obj.value = window.getComputedStyle(c[i]).width;
                c[i].style.width = "0px";
            }
            obj.panel = p[i];
            obj.overlay = o[i];
            obj.container = c[i];
            targets.push(obj);
            inCompleteList.push(obj);
        }

        
        var pf = function(e){
            for(var i=0;i<targets.length;i++){
                if(targets[i].animHeight){
                    if(targets[i].container.style.height !== "0px"){
                        close(targets[i]);
                    }
                } else {
                    if(targets[i].container.style.width !== "0px"){
                        close(targets[i]);
                    }
                }
            }
            i = parseInt(e.currentTarget.getAttribute("data-overlayNum"));
            open(targets[i]);
        };

        var of = function(e){
            var n = parseInt(e.currentTarget.getAttribute("data-overlayNum"));
            close(targets[n]);
        };

        var close = function(tg){
            if(!tg.closed){
                var imgUrl = window.getComputedStyle(tg.panel)
                                    .backgroundImage.replace(/\.jpg/, "_closed.jpg");
                tg.panel.style.backgroundImage = imgUrl;
                tg.closed = true;
            }
            var tl = new TimelineMax();
            var p = tg.animHeight ? {height: "0px"} : {width: "0px"};            
            tl.to(tg.container, .75, p);
        };

        var open = function(tg){
            var tl = new TimelineMax();
            var p = tg.animHeight ? {height: tg.value} : {width: tg.value};
            tl.to(tg.container, .75, p);
            if(!isComplete){
                if(getIsComplete(tg)){
                    isComplete = true;
                    lnx.cache.setValue("complete", scrId, true);
                    lnx.view.onScreenComplete();
                }
            }
        };
        
        for(var i =0;i<targets.length;i++){
            targets[i].panel.setAttribute("data-overlayNum", i);
            targets[i].panel.addEventListener("click", pf, false);
            targets[i].overlay.setAttribute("data-overlayNum", i);
            targets[i].overlay.addEventListener("click", of, false);
        }

        function getIsComplete(tg){
            var l = inCompleteList;
            if(l.length){
                for(var i=0;i<l.length;i++){
                    if(l[i] === tg){                        
                        l.splice(i, 1);
                        if(!l.length){
                            return true;
                        }
                        break;
                    }
                }
            } else {
                return true;
            }
        }



        function setStyles(p, d){
            var o = {};
            o.diam = d[1];
            var top = 0, left = 0, cd;
            for(i=0;i<p.length;i++){
                cd = d[i+1];
                
                p[i].style.width = cd[0] + "px";
                p[i].style.height = cd[1] + "px";
                var img = 'images/' + scrId + '_mp_' + (i+1) + '.jpg';
                p[i].style.backgroundImage = "url(" + img + ")";
                p[i].style.top = top + "px";
                p[i].style.left = left + "px";

                if(o.diam[1] !== cd[1]){
                    top = cd[1] + 20;
                } else {
                    top = 0;
                    left += cd[0] + 20;
                }
            }            
        }

        // remember for destruction
        targets.panelFunc = pf;
        targets.overlayFunc = of;
        this.items = targets;
    },    
   
    
    hasContent : function(){        
        return false;
    },
    
    
    destroy : function(){
        var pf = this.items.panelFunc;
        var of = this.items.overlayFunc;
        for(var i=0;i<this.items.length;i++){
            this.items[i].panel.removeEventListener("click", pf, false);
            this.items[i].overlay.removeEventListener("click", of, false);
        }
        this.items = [];
    }
};

lnx.learningCheck = {
    items : [],
    id: null,
    cancelTimeout: null,
        
    init : function( node, screenElm, frameElm ){ 

        var self = this;
        var id = screenElm.getAttribute("id");
        var ctnClass = ".LearningCheck";
        var btn = screenElm.querySelector(ctnClass + " > div > div");
        var img = screenElm.querySelector(ctnClass + " > div > div img");
        var btnTxt = btn.querySelector("p");
        var header = screenElm.querySelector(ctnClass + " > div");
        var panel = screenElm.querySelector(ctnClass + " > div:nth-child(2)");
        var txt = screenElm.querySelector(ctnClass + " > div:nth-child(2) > div:first-child");
        var txtAlts = screenElm.querySelectorAll(ctnClass + " > div:nth-child(2) > div:nth-of-type(2) > *");
        txtAlts = Array.prototype.slice.call(txtAlts);
        if(txtAlts.length < 6){
            txtAlts[5] = {outerHTML: ""};
        }
        var correctAns = screenElm.getAttribute("data-correctAns");
        var prxBtn = screenElm.querySelector(".twoOneCol > div:nth-child(3)");
        var con = screenElm.querySelector(ctnClass);
        var qs = screenElm.querySelector(".twoOneCol > div:nth-child(1)");
        con.style.zIndex = "-1";
        var attempts = 0;
        var mustGetCorrect = node.getAttribute("subType") === "2" ? true : false;
        var resultAudio = screenElm.getAttribute("data-resultAudio");
        if(resultAudio){
            resultAudio = resultAudio.split(",");
        } else {
            resultAudio = ["NotCorrect", "PartCorrect", "Correct"];
        }
        var delayAudio = null;
        var a = screenElm.querySelector("[data-delayAudio]");
        if(a){
            delayAudio = a.getAttribute("data-delayAudio").split(",");
        }
        var doCourseCompletion = screenElm.getAttribute("data-doCourseCompletion") === "true";
        var isBinary = screenElm.querySelectorAll("label").length === 2;

        var open = false;
        var tl = new TimelineMax();
        var pHt = window.getComputedStyle(panel).height;
        panel.style.height = "0px"; 

        // prxBtn.style.display = "none";
        // btn.style.display = "none";
        //btnTxt.innerHTML = lnx.localization.getLocalString("s13");
        //tl.to(btnTxt, .2, {text: lnx.localization.getLocalString("s13")});
        tl.to(header, .75, {top: "0px"}, 0);
        tl.to(btn, .75, {right: "15px"}, 0);
        tl.to(panel, .75, {height: pHt, onReverseComplete: onReverseComplete}, 0);
        tl.to(txt, .3, {opacity: 1});
        tl.pause(); 

        lnx.util.stopVOverflow(screenElm.querySelector("div.LearningCheckCon > div.twoOneCol > div:first-child"));
        
        function onReverseComplete(){
            con.style.zIndex = "-1";
            prxBtn.style.display = "block";
            btn.style.display = "none";
            if(attempts < 2){
                var lCheck = document.getElementsByName('lCheck');               
                for(var i = 0; i < lCheck.length; i++){
                    lCheck[i].checked = false;
                }
            }
            // prxBtn.style.display = "none";
            // btn.style.display = "none";
        }      

        var f = function(e){             
            clearTimeout(self.cancelTimeout);
            lnx.audio.stopAudio();
            if(open){
                tl.reverse();
                open = false;
            } else {
                con.style.zIndex = "10";
                prxBtn.style.display = "none";
                btn.style.display = "block";
                var r = getResult(), t;
                attempts++;
                txt.innerHTML = "";
                var PART_CORRECT = 0;
                var idx = 1;
                var num = 2;
                if(r){
                    txt.style.paddingTop = 0;  
                    t = txtAlts[2].outerHTML + txtAlts[4].outerHTML + txtAlts[5].outerHTML;
                    lnx.cache.setValue("complete", id, true);
                    lnx.view.onScreenComplete();
                    if(resultAudio){
                        lnx.audio.playAudio(resultAudio[2]);
                    }
                    if(doCourseCompletion){
                         lnx.scormApi.lmsCompleteCourse(true);
                    }
                } else if(!isBinary && (attempts<2 || mustGetCorrect)){
                    num = r === PART_CORRECT ? 1 : 0;
                    t = txtAlts[num].outerHTML + txtAlts[3].outerHTML;
                    idx = 0;
                } else {
                    num = r === PART_CORRECT ? 1 : 0;
                    txt.style.paddingTop = 0;                   
                    t = txtAlts[num].outerHTML + txtAlts[4].outerHTML + txtAlts[5].outerHTML;
                    lnx.cache.setValue("complete", id, true);
                    lnx.view.onScreenComplete();
                }
                if(resultAudio){
                    lnx.audio.playAudio(resultAudio[num]);
                } 
                if(delayAudio){
                    self.cancelTimeout = setTimeout(function(){lnx.audio.playAudio(delayAudio[idx])}, 2750);
                }
                txt.innerHTML = t;
                if(r || isBinary || (!r && attempts > 1 && (!mustGetCorrect))){
                    tl.clear();
                    tl.to(btn, .1, {opacity: 0}, 0);
                    tl.to(header, .75, {top: "0px"}, 0);
                    tl.to(panel, .75, {height: pHt}, 0);
                    tl.to(txt, .3, {opacity: 1});
                    tl.play();
                } else {
                    tl.play();
                }                
                open = true;
            }           
        };
       
        
        function getResult(){
            var result = null;
            var lCheck = document.getElementsByName('lCheck');
            var checked = [];
            for(var i = 0; i < lCheck.length; i++){
                if(lCheck[i].checked){
                    checked.push(lCheck[i].value);
                    if (correctAns.search(lCheck[i].value + "(,|$)") > -1) {
                        result = 0;
                    }
                }
            }
            checked = checked.sort().join(",");            
            return correctAns === checked ? 1 : result;
        }

        btn.addEventListener("click", f, false);        
        prxBtn.onclick = function(){f()};
        // qs.onchange = function(){
        //     console.log('onchange');
        //     prxBtn.style.display = "block";
        //     btn.style.display = "block";
        // };
        this.items = [btn, f, prxBtn, qs];
    },    
    
    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){

        this.items[0].removeEventListener("click", this.items[1], false);
        this.items[2].onclick = null;
        //this.items[3].onchange = null;
        this.items = [];
        clearTimeout(this.cancelTimeout);
    }
},

lnx.learnHow = {
    
    items : [],
        
    init : function( node, screenElm, frameElm ){ 

        var id = screenElm.getAttribute("id");
        var isComplete = false;
        var ctnClass = ".learnHowContainer";
        if(node.getAttribute("subType") === "more"){ // fixed error - test before release
            ctnClass = ".learnMoreContainer";
        }

        var btn = screenElm.querySelector(ctnClass + " > div > div");
        var img = screenElm.querySelector(ctnClass + " > div > div img");
        var btnTxt = btn.querySelector("p");
        var header = screenElm.querySelector(ctnClass + " > div");
        var panel = screenElm.querySelector(ctnClass + " > div:nth-child(2)");
        var txt = screenElm.querySelector(ctnClass + " > div:nth-child(2) > div");

        var open = false;
        var tl = new TimelineMax();
        var pHt = window.getComputedStyle(panel).height;
        panel.style.height = "0px";    

        var f = function(e){
            if(!isComplete){
                lnx.cache.setValue("complete", id, true);
                lnx.view.onScreenComplete();
                isComplete = true;
            }
            if(open){
                tl.reverse();
            }else{
                if(tl.reversed()){
                    tl.play();
                }else{
                    tl.to(btnTxt, .2, {opacity: 0});
                    tl.to(header, .75, {top: "0px"}, 0);
                    tl.to(btn, .75, {right: "20px"}, 0);
                    tl.to(panel, .75, {height: pHt}, 0);
                    tl.to(txt, .3, {opacity: 1});
                    tl.to(img, 0, {src: "images/button_close.png"}, .2);
                }                
            }       
            open = !open;
        };        
        btn.addEventListener("click", f, false);
        this.items = [btn, f];
    },    
    
    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){

        this.items[0].removeEventListener("click", this.items[1], false);
        this.items = [];
    }
};

lnx.moveUp = {

    items : [],
        
    init : function( node, screenElm, frameElm ){ 
        
        var id = screenElm.getAttribute("id");
        var isComplete = this.enabled = ((lnx.cache.getValue("complete", id) === true) || !lnx.nav.getIsScreenLocked());
        var ctnClass = ".moveUpContainer";
        var con = screenElm.querySelector(ctnClass);

        var btn = this.btn = screenElm.querySelector(ctnClass + " > div > div");
        if(!this.enabled){
            btn.classList.add("btnDisabled");
        }
        var img = screenElm.querySelector(ctnClass + " > div:nth-child(1) > div");
        var btnTxt = btn.querySelectorAll("p")[0];
        var btnClose = btn.querySelectorAll("p")[1];
        var header = screenElm.querySelector(ctnClass + " > div");
        var panel = screenElm.querySelector(ctnClass + " > div:nth-child(2)");
        var txt = screenElm.querySelector(ctnClass + " > div:nth-child(2) > div");
        var audio = screenElm.querySelector(ctnClass).getAttribute("data-audio");

        // change height, location of div.moveUpContainer when closed to
        // allow links below to be clicked        
        var conClosedVals = { h: "4.375rem", t: "24.9375rem", t2: "1.125rem" };
        var conOrigVals = getOriginalVals();
        var self = this;

        lnx.util.stopVOverflow(screenElm.querySelector("div.moveUp > div:first-of-type"));
        lnx.util.stopVOverflow(screenElm.querySelector(".moveUpContainer > div:nth-of-type(2) > div"));

        //updateConVals();

        var open = false;
        var tl = gsap.timeline();
        //var pHt = pxToRem(window.getComputedStyle(panel).height, true);
        var pHt = "90%";
        panel.style.height = "0%";    

        var f = function(e){
           
            if(!self.enabled) return;
            lnx.audio.stopAudio();
            if(!isComplete){
                lnx.cache.setValue("complete", id, true);
                lnx.view.onScreenComplete();
                isComplete = true;
            }
            if(open){
                tl.reverse();
            }else{
                updateConVals(true);
                lnx.audio.playAudio(audio, 1000);
                if(tl.reversed()){
                    tl.play();
                }else{
                    tl.to(btnTxt, .2, {opacity: 0});
                    tl.to(btnClose, .2, {opacity: 1}, .55);
                    tl.to(btnClose, 0, {visibility: "visible"});
                    tl.to(header, .75, { top: "-0.4375rem", onReverseComplete: updateConVals }, 0 );
                    tl.to(btn, .75, {right: "2.15%"}, 0);
                    tl.to(btn, .75, {width: "2.8%"}, 0);
                    tl.to(btn, .75, {height: "52%"}, 0);
                    tl.to(btn, .75, {top: "0.875rem"}, 0);
                    tl.to(panel, .75, {height: pHt}, 0);
                    tl.to(txt, .3, {opacity: 1});
                    //tl.to(img, 0, {src: "images/button_close.png"}, .2);
                }                
            }       
            open = !open;
        };        
        btn.addEventListener("click", f, false);
        this.items = [btn, f];

        function getOriginalVals() {
            var st = window.getComputedStyle(con);
            return { h: pxToRem(st.height), t: pxToRem(st.top), t2: pxToRem(window.getComputedStyle(con.firstChild).top) }
            //return { h: "30.5625rem", t: "-1.3125rem", t2: "27.3125rem" };
        }

        function normalizeRem(v){
            v = parseFloat(v);
            return (v * lnx.config.getFontMultiplier()) + "rem";
        }

        function pxToRem(v){
            v = parseFloat(v);
            v *= lnx.config.getFontMultiplier();
            return (v/16) + "rem";
        }
        function updateConVals(isOpening) {
            //var fm = lnx.config.getFontMultiplier();
            var vals = isOpening ? conOrigVals : conClosedVals;            
            con.style.height = vals.h;
            con.style.top = vals.t;
            con.firstChild.style.top = vals.t2;
        }    

        // function stopVOverflow(){
        //     var d = screenElm.querySelector("div.moveUp > div:first-of-type");                
        //     if(d.scrollHeight > d.clientHeight){
        //         var sz = parseInt(getComputedStyle(d).fontSize);
        //         while(sz > 11){
        //             sz -= 1;
        //             d.style.fontSize = (sz + "px");
        //             if(d.scrollHeight <= d.clientHeight){
        //                 break;
        //             }
        //         }
        //     }
        // }
    },    

    onAudioFinish: function(){
        this.enabled = true;
        this.btn.classList.remove("btnDisabled");
    },

    OnNavEventRejectedNotice: function(){
        //lnx.view.showUserNoticeGen("You must complete this exercise before moving forward.");
    },
    
    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){

        this.items[0].removeEventListener("click", this.items[1], false);
        this.btn = null;
        this.items = [];
    }
};

lnx.matching = {

    items : [],
    doActivity: null,

    init: function(node, screenElm, frameElm){

        // read data-match attribute value list from xml
        // list order should match order of items in markup 
        // e.g. 1,3 maps to first item in left col and 3rd item in right
        var tl = new TimelineMax();
        var l = screenElm.querySelectorAll(".matching > div:nth-child(1) > div");
        var r = screenElm.querySelectorAll(".matching > div:nth-child(2) > div");
        var m = screenElm.querySelector(".matching");
        var completeMsg = screenElm.querySelector(".matching > div:nth-child(3)");
        var cv1 = screenElm.querySelector(".matchCanvas"); 
        var w = window.getComputedStyle(cv1).width;
        var ctx1 = cv1.getContext('2d');
        var cY1, cY2;
        var matchLines = [];
        var lineWidth = 5;
        //var colors = {fail:"#CC3359", success: "#7EBB00", orange: "#EC6A00"};
        var colors = {fail:"#aeb0bc", success: "#aeb0bc", orange: "#EC6A00", green: "#01AF40", alt: "#aeb0bc"};
        var origImgSrc = m.getAttribute("data-btnSrc1");
        var onImgSrc = m.getAttribute("data-btnSrc2");
        var isComplete = false;
        var self = this;
        var forRemoval = null;

        var matchItems = {
            left: {},
            right: {}
        };
        var matches = m.getAttribute("data-match").split(",");

        for(var i =0;i<matches.length;i++){
            matches[i] = parseInt(matches[i]) - 1; // update for easier 0 based indexing
        }
        cv1.setAttribute('width', w);
        cv1.setAttribute('height', window.getComputedStyle(cv1).height);
        w = w.slice(0, -2); // prepare for use in drawLine func below

        for(var i =0;i<matches.length;i+=2){
            var leftId = matches[i];
            var rightId = matches[i+1];
            var o = {
                item:       l[leftId],
                itemId:     leftId, 
                match:      r[rightId],
                matchId:    rightId, 
                selected: false,
                matched: false,
                side: "left"
            };
            var o2 = {
                item:       r[rightId],
                itemId:     rightId, 
                match:      l[leftId],
                matchId:    leftId, 
                selected: false,
                matched: false,
                side: "right"
            };
            o.matchObj = o2;
            o2.matchObj = o;
            matchItems.left[leftId] = o;
            matchItems.right[rightId] = o2;

            // add lookup values to html elements       
            l[leftId].setAttribute("data-itemId", leftId);
            l[leftId].setAttribute("data-matchId", rightId);
            l[leftId].setAttribute("data-side", "left");
            r[rightId].setAttribute("data-itemId", rightId);
            r[rightId].setAttribute("data-matchId", leftId);
            r[rightId].setAttribute("data-side", "right");
        }
        
        // IE 10 does not support pointer-events: none, so clicks do not pass through canvas element
        // workaround: create a set of nodes above canvas to proxy clicks to nodes below canvas
        var dL = document.createElement("div");
        dL = m.appendChild(dL);
        var dR = dL.cloneNode();
        dR = m.appendChild(dR);
        dL.className = "matchingProxyLeft";
        dR.className = "matchingProxyRight";
        
        var num = l.length;
        var s = "";
        for(var i=0;i<num;i++){
            s += "<div></div>";
        }
        dL.innerHTML = s;
        dR.innerHTML = s;

        var h = l[0].getBoundingClientRect().height + "px";

        // listeners
        var proxyMouseOver = function(e){            
            toggleOverState(e, true);
        };

        var proxyMouseOut = function(e){
            toggleOverState(e, false);
            if(forRemoval){
                removeListeners(forRemoval[0], forRemoval[1]);
                forRemoval = null;
            }
        };

        var proxyClick = function(e){
            var num = parseInt(e.currentTarget.getAttribute("data-itemId"));
            var side = e.currentTarget.getAttribute("data-side") === "left" ? l : r;
            doMatch(side[num]);
        };

        for(var i=0;i<num;i++){ 
            dR.childNodes[i].style.height = dL.childNodes[i].style.height = h;
            dR.childNodes[i].style.width = dL.childNodes[i].style.width = "100%";
            dL.childNodes[i].setAttribute("data-side", "left");
            dL.childNodes[i].setAttribute("data-itemId", i);
            dR.childNodes[i].setAttribute("data-side", "right");
            dR.childNodes[i].setAttribute("data-itemId", i);
            dL.childNodes[i].addEventListener("mouseover", proxyMouseOver, false);
            dL.childNodes[i].addEventListener("mouseout", proxyMouseOut, false);
            dR.childNodes[i].addEventListener("mouseover", proxyMouseOver, false);
            dR.childNodes[i].addEventListener("mouseout", proxyMouseOut, false);
            dL.childNodes[i].addEventListener("click", proxyClick, false);
            dR.childNodes[i].addEventListener("click", proxyClick, false);
        }       
      
        var removeListeners = function(ln, rn){
           var a = [dL.childNodes[ln], dR.childNodes[rn]];
           for(var i=0;i<a.length;i++){ 
                a[i].removeEventListener("mouseover", proxyMouseOver, false);
                a[i].removeEventListener("mouseout", proxyMouseOut, false);
                a[i].removeEventListener("click", proxyClick, false);
                a[i].style.cursor = "default";
           }
        };

        var toggleOverState = function(e, over){
            e.currentTarget.style.cursor = over ? "pointer" : "default";
            var num = parseInt(e.currentTarget.getAttribute("data-itemId"));
            var side = e.currentTarget.getAttribute("data-side") === "left" ? l : r;
            var f = over ? "add" : "remove";
            side[num].classList[f]("matchingBgColor");
        };
        
        var doMatch = function(m){
            var id = m.getAttribute("data-itemId");
            var side =  m.getAttribute("data-side") === "left" ? matchItems.left : matchItems.right;
            var opSide = m.getAttribute("data-side") === "left" ? matchItems.right : matchItems.left;
            var obj = side[id];
            // if already matched, do nothing
            if(obj.matched){
                return;
            }
            if(obj.selected){
                // deslect
                switchState(false, m, obj);
                return;
            }
            // select item
            switchState(true, m, obj);              
            // deselect any other items already selected on that side
            for(var p in side){
                if(p !== id && side[p].selected && !side[p].matched){
                    switchState(false, side[p].item, side[p]);
                }
            }
            // check for a match
            if(obj.matchObj.selected){
                //console.log('matched');
                obj.matched = obj.matchObj.matched = true;
                drawLines(obj, obj.matchObj, true);
                // remove listeners
                var args = obj.side === "left" ? [obj.itemId, obj.matchId] : [obj.matchId, obj.itemId];
                //removeListeners(args[0], args[1]);
                forRemoval = args;

                // check for completion
                for(var p in opSide){
                    if(!side[p].matched){
                        return;
                    }
                }
                // if we get here, exercise complete
                //console.log("all matched!")
                isComplete = true;
                return;
            } 
            // check for a bad match attempt
            for(var p in opSide){
                if(opSide[p].selected && !opSide[p].matched){
                    //console.log('bad match');
                    drawLines(obj, opSide[p], false);
                    return;
                }
            }
            // must be a new attempt, first item of pair selected only
            //console.log('new attempt at match');            
        };

        var switchState = function(select, elm, obj){
            //elm.querySelector("img").src = select ? onImgSrc : origImgSrc;
            elm.querySelector("div").style.borderColor = select ? "#0c8e3b" : "#fff";
            elm.querySelector("div:first-child").style.backgroundColor = select ? "#01AF40" : "#fff";
            elm.querySelector("div:first-child").style.color = select ? "#01AF40" : "#fff";
            obj.selected = select;
        };

        var clearBadSelectStates = function(o1, o2){
            switchState(false, o1.item, o1);
            switchState(false, o2.item, o2);
        };

        // utility function called when generating screen shots only
        self.doActivity = function(){
            drawLines(null,null,null,"shortCircuit");            
        };    

        function drawLines(obj1, obj2, success, shortCircuit){

            // hack to access inner drawMatchLines function when generating screenshots
            if(shortCircuit === "shortCircuit"){
                shortCircuitActivity();
                return;                
            }

            var col1 = colors.green;
            var col2 = success ? colors.success : colors.fail;            
            var pos = "+=0";            
            var finalComplete = success ? goodFinalComplete : badFinalComplete;
            var color;
            var params;
            
            cY1 = obj1.item.offsetTop + (obj1.item.clientHeight/2-(lineWidth/2));
            cY2 = obj2.item.offsetTop + (obj2.item.clientHeight/2-(lineWidth/2));
            if(obj1.side === "right"){
                var t = cY1;
                cY1 = cY2;
                cY2 = t;
            }

            tl.clear();
            
            // draw a line 4 times alternating color
            for(var i=0;i<5;i++){
                color = (i%2) ? col2 : col1;
                params = {onStart: clearCanvas, onComplete: onComplete, onCompleteParams: [color]};
               
                if(i){
                    pos = "+=.4"; // position at .4 second on timeline except for first time
                } 
                if(i===4){ // special case for final complete callback
                    params.onComplete = finalComplete;
                    color = col1;
                }
                console.log("drawlines: " + color);
                tl.to(ctx1, 0, params, pos);
            }    

            function shortCircuitActivity(){
                for(var i =0;i<matches.length;i+=2){
                    obj1 = matchItems.left[matches[i]];
                    obj2 = matchItems.left[matches[i+1]];
                    matchLines.push(
                        [obj1.item.offsetTop + (obj1.item.clientHeight/2-(lineWidth/2)),
                        obj2.item.offsetTop + (obj2.item.clientHeight/2-(lineWidth/2))]
                    );                
                }
                drawMatchLines();
                showCompletion();
            }

            function onComplete(c){
                draw(null, null, c);
                drawMatchLines();
            }

            function goodFinalComplete(c){
                draw(null, null, c);
                matchLines.push([cY1, cY2]); 
                drawMatchLines();
                if(isComplete){
                    showCompletion();
                }
            }

            function badFinalComplete(c){
                draw(null, null, c);
                clearCanvas();
                drawMatchLines();
                clearBadSelectStates(obj1, obj2);
            }

            function drawMatchLines(){
                for(var i=0;i<matchLines.length;i++){
                    var y1 = matchLines[i][0];
                    var y2 = matchLines[i][1];
                    draw(y1, y2, colors.green);
                }
            }

            function draw(y1, y2, c){
                if(!y1){
                    // if we are not passed coords use current ones in closure
                    y1 = cY1;
                    y2 = cY2;
                }
                ctx1.strokeStyle = c;   
                ctx1.lineWidth = lineWidth;             
                ctx1.beginPath();
                ctx1.moveTo(0, y1);
                ctx1.lineTo(w, y2);
                ctx1.stroke();
            }

            function clearCanvas(){
              ctx1.clearRect(0, 0, cv1.width, cv1.height);
            }

            function showCompletion(){
                completeMsg.style.display = "block";
                var audio = completeMsg.getAttribute("data-audio");
                if(audio){
                    lnx.audio.playAudio(audio);
                }
            }
        }

        // remember for removel of event listerners
        this.items = [dL, dR, proxyMouseOver, proxyMouseOut, proxyClick];
    },

    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){
        
        var dL = this.items[0];
        var dR = this.items[1];
        var funcs = ["proxyMouseOver", "proxyMouseOut", "proxyClick"]
        for(var i =0;i<dL.length;i++){
             for(var j =0;j<funcs.length;j++){
                dL[i].removeEventListener(funcs[j], this.items[j+2], false);
                dR[i].removeEventListener(funcs[j], this.items[j+2], false);
            }
        }
        this.items = [];
    }
};


lnx.imgSequence = {

    items : [],

    init: function(node, screenElm, frameElm){

        var imgs = screenElm.querySelectorAll("img");
        var tl = new TimelineMax({repeat:-1});
        tl.staggerFromTo(imgs, 2, {opacity:0}, {opacity:1}, 4);
        this.items.push(tl);
    },

    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){
       this.items[0].kill();
       this.items = [];
    }

};

lnx.selectRevealEmail = {

    items : [],
    id: null,
    stage: null,
    audio: [],
    numScreens: null,
    nodeId: null,

    init: function(node, screenElm, frameElm, origNavId){

        var self = this;
        this.id = screenElm.getAttribute("id");
        this.resId = node.getAttribute("resId");
        this.numScreens = parseInt(screenElm.getAttribute("data-numscreens"));
        this.screen = 1;
        var host = screenElm.querySelector("div.outerEmail");
        var frag = document.createDocumentFragment();
        frag.appendChild(host.firstChild.cloneNode(true)); 
        this.cover = document.createElement("div");        
        host.appendChild(this.cover);
        host.appendChild(frag);
        this.email = host.childNodes[2];
        this.textBoxes = screenElm.querySelectorAll("div.slTxtContainer > p");

        if(origNavId === "prev"){
            // must be reversing into activity so show last virtual screen
            this.insertVirtualScreen("prev", true);
        }
        this.playAudio();
    },

    getResId: function(){
        return this.resId + "_" + this.screen;
    },

    playAudio: function(){
        lnx.audio.playAudio(this.getResId());
        console.log("Audio Play " + this.getResId());
    },

    hasContent : function(){
        if(this.initialized){
            return true;
        } else {
            return false;
        }
    },

    updateVirtualScreen: function(dir, showFinalReverse){
        var rm = dir === "next" ? this.screen - 1: this.screen + 1;
        var ad = this.screen;
        this.email.classList.remove("emClip" + rm);
        this.email.classList.add("emClip" + ad);

        ad = this.screen - 2;
        rm = dir === "next" ? this.screen - 3: this.screen - 1;
        if(ad >= 0){
            this.textBoxes[ad].classList.add("showEmTextBox");
        }
        
        if(rm >= 0 && rm < this.textBoxes.length){
            this.textBoxes[rm].classList.remove("showEmTextBox");
        }
        this.playAudio();
    },

    insertVirtualScreen: function(dir, showFinalReverse){        
        if(showFinalReverse){
            this.screen = this.numScreens + 1;
            // stage will be decrimented to correct value below in "prev" conditional
        }
        
       if(dir === "next"){
            if(this.screen < this.numScreens){
                this.screen++;
                //lnx.audio.stopAudio();
                this.updateVirtualScreen(dir);
                //lnx.audio.playAudio(this.audio[this.stage-1], audioDelay);
                //check are we now on last screen
                if(!((this.screen + 1) < this.numScreens)){

                }
                return true;
            }else{
                return false;
            }
       }else if(dir === "prev"){
            if(this.screen < 2){
                return false;
            }else{
                this.screen--;
                this.updateVirtualScreen(dir, showFinalReverse);
                return true;
            }       
        }else{
            return false;
        }
    },

    isComplete: function(){
        return lnx.cache.getValue("complete", this.id);    
    },

    isFinalScreen: function(){
        return (this.screen >= this.numScreens)
    },

    destroy : function(newType, navId){   
        if(navId === this.id){
            return;        
        }        
        this.screen = null;
        this.resId = this.id = null;
    }

};

lnx.selectReveal = {

    items : [],

    init: function(node, screenElm, frameElm){
        var elms = screenElm.querySelectorAll(".slContainer > div");
        var fb = screenElm.querySelector(".slFeedback");
        var txts = screenElm.querySelectorAll(".slTxtContainer > span");
        var scoreElm = screenElm.querySelector(".slScore > span");
        var score = 0;
        var list = [];
        var isComplete = false;
        var id = screenElm.getAttribute("id");

        for(var i=0;i<elms.length;i++){
            elms[i].onclick = onClick;
            elms[i].setAttribute("data-num", i);
            list.push(elms[i]);
        }
       
        function onClick(e){
            e = e.target;            
            if(list.length){
                for(var i=0;i<list.length;i++){
                    if(list[i] === e){                        
                        list.splice(i, 1);
                        scoreElm.innerHTML = ++score;
                        lnx.audio.stopAudio();
                        if(!list.length){
                            //screenElm.querySelector(".slImageOvelay").style.display = "block";
                            var elm = screenElm.querySelector(".slImageOvelay");
                            elm.style.opacity = "0";
                            elm.style.display = "block";
                            var tl = new TimelineMax();
                            tl.to(elm, 1, {opacity: 1, delay: .75});
                            if(!isComplete){
                                lnx.cache.setValue("complete", id, true);
                                lnx.view.onScreenComplete();
                                isComplete = true;
                            }
                            var audio = elm.getAttribute("data-audio");
                            if(audio){
                                lnx.audio.playAudio(audio);
                            }
                        }
                        break;
                    }
                }
            }
            e.style.opacity = "1";
            fb.style.display = "block";
            fb.innerHTML = txts[e.getAttribute("data-num")].outerHTML;
            
        }
        this.items[0] = elms;
    },

    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){  
        if(this.items[0]){
            var elms = this.items[0];
            for(var i=0;i<elms.length;i++){
                elms[i].onclick = null;
            }
        }
        this.items = [];
    }
};

lnx.overlayMan = {

    overlay: null,
    closeBtn: null,
    payLoad: null,
    initialized: false,

    init: function(){
        var self = this;
        this.overlay = document.body.querySelector('.overlay');
        if(!this.overlay) return;
        this.overlay.querySelector("img").onclick = function(){
            self.hide();
        };
        this.payLoad = this.overlay.querySelector("div:nth-of-type(2)");
        this.initialized = true;
    },

    show: function(text){
        if(!this.initialized) return;
        this.overlay.style.display = "block";
        this.payLoad.innerHTML = text;
    },

    hide: function(){
        if(!this.initialized) return;
        this.overlay.style.display = "none";
    }
};

lnx.basicWithVideo = {

    link: null,
    vid: null,

    init : function( node, screenElm, frameElm ){
        var self = this;
        this.link = screenElm.querySelector("span.underline");
        this.vidDiv = screenElm.querySelector("div.vidOverlay");
        this.vid = screenElm.querySelector("video");
        this.link.onclick = function(e){
            self.vidDiv.style.display = "block";
            self.vid.play();
            lnx.audio.stopAudio();
        };
        this.vidClose = screenElm.querySelector(".videoClose");
        this.vidClose.onclick = function(e){
            self.vidDiv.style.display = "none";
            self.vid.pause();
        };

},

    hasContent : function(){
        
        return false;
    },

    destroy: function(){
        this.link.onclick = null;
        this.link = null;
        this.vidClose.onclick = null;
        this.vidClose = null;
    }
};

lnx.steps = {
    
    items : [],
    imgRefPref: null,
    popUp: null,
    type: null,
    popUpClose: null,
    popUnderlay: null,
    handlers: [],    
    hasAudio: false,
    props: [],
    vid: null,
    
    init : function( node, screenElm, frameElm ){
    
        var self = this;
        // get clickable items
        var a = this.items = Array.prototype.slice.call(screenElm.querySelectorAll("div.clickable"));
        var numSteps = a.length;
        for(var i=0;i<numSteps;i++){
            var o = {};
            o.color = window.getComputedStyle(a[i]).backgroundColor;
            o.image = a[i].parentNode.querySelector("div[data-optionNum=\"" + a[i].getAttribute("data-optionNum") + "\"] > img").getAttribute("src");
            this.props.push(o);
        }
        
        this.popUp = screenElm.querySelector(".popup");  
        this.popUpClose = this.popUp.querySelector("img.popupClose");
        this.popUnderlay = this.popUp.querySelector("div.popUnderlay");
        this.type = node.getAttribute("subType");
        if(this.type === "2"){
            this.imgRefPref = node.getAttribute("navId") + "_";
        }
        lnx.util.updateEventListener(this.items, "click", this.onSelection);   
        lnx.util.updateEventListener(this.popUpClose, "click", onClose);
        this.handlers.push(onClose);
        lnx.util.updateEventListener(this.popUnderlay, "click", onClickUnderlay);
        this.handlers.push(onClickUnderlay);

        function onClose(e){

            var video = self.popUp.querySelector("video");
            if(video){
                video.pause();
                self.vidLink = self.popUp.querySelector("p>span.underline");                
                self.vidLink.onclick = null;
                self.videoDiv = self.popUp.querySelector("div.vidOverlay");
                self.videoDiv.style.display = "none";
                self.vidClose.onclick = null;
                self.vidClose = null;
            }

            self.popUp.style.display = "none";
            if(self.hasAudio){
                lnx.audio.stopAudio();
            }            
        }

        function onClickUnderlay(e){
            if(e.target === e.currentTarget){
                onClose();
            }
        }     

        this.navBtns = Array.prototype.slice.call(this.popUp.querySelectorAll("img.clickable"));
        lnx.util.updateEventListener(this.navBtns, "click", onNav);
        this.handlers.push(onNav); 
        if(!this.navBtns[0].getAttribute("data-bupTitle")){
            this.navBtns[0].setAttribute("data-bupTitle", this.navBtns[0].getAttribute("title"));
            this.navBtns[1].setAttribute("data-bupTitle", this.navBtns[1].getAttribute("title"));
        }

        function onNav(e){
            var self = lnx.steps; 
            var num = parseInt(e.currentTarget.parentNode.getAttribute("data-optionNum"));
            var fwd = e.currentTarget.classList.contains("stepFwd");
            var doNav = false;

            if((fwd && num < numSteps) || (!fwd && num > 1)){
                num = fwd ? ++num : --num;
                doNav = true;  
            }

            if(doNav){
                var gp = e.currentTarget.parentNode.parentNode;
                var t = gp.querySelector("div.step.clickable[data-optionNum=\"" + num + "\"]");
                onClose();
                sendEvent(t);
            }

            self.setNavBtnStates(num, numSteps);

            function sendEvent(n){
                var e = document.createEvent('MouseEvents');
                e.initMouseEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null)
                n.dispatchEvent(e);         
            }
        }
    },
    
    setNavBtnStates: function(num, numSteps){
        var self = lnx.steps;

        if(num > (numSteps - 1)){
            self.navBtns[1].classList.remove("clickable");
            self.navBtns[1].style.opacity = ".35";
            self.navBtns[1].setAttribute("title", "");
        }else{
            self.navBtns[1].classList.add("clickable");
            self.navBtns[1].style.opacity = "1";
            self.navBtns[1].setAttribute("title", self.navBtns[1].getAttribute("data-bupTitle"));
        }
        if(num < 2){
            self.navBtns[0].classList.remove("clickable");
            self.navBtns[0].style.opacity = ".35";
             self.navBtns[0].setAttribute("title", "");
        }else{
            self.navBtns[0].classList.add("clickable");
            self.navBtns[0].style.opacity = "1";
            self.navBtns[0].setAttribute("title", self.navBtns[0].getAttribute("data-bupTitle"));
        }
    },

    onSelection : function( e ){

        e = e || window.event;
        var self = lnx.steps;        
        var num = parseInt(e.currentTarget.getAttribute("data-optionNum"));
        var audio = e.currentTarget.getAttribute("data-audio");

        self.popUp.setAttribute("data-optionNum", ("" + num));
        self.popUp.querySelector("div.popHeader").style.backgroundColor = self.props[num-1].color;
        self.popUp.querySelector("div.popHeader > img").setAttribute("src", "images/step" + num + ".png");
        self.popUp.querySelector("div.popBody > img").setAttribute("src", self.props[num-1].image);

        self.setNavBtnStates(num);
        
        if(self.type === "2"){
            self.popUp.querySelector("div.popHeader > img").src = "images/" + self.imgRefPref + num + ".jpg";
        } else if(self.type === "3"){
            var hdr = self.popUp.querySelector(".popHeader");
            hdr.style.backgroundColor = window.getComputedStyle(e.currentTarget, null).backgroundColor;
            hdr.innerHTML = e.currentTarget.querySelector("div>span").innerHTML;
        } else if(self.type === "4"){
            var hdr = self.popUp.querySelector(".popHeader");
            var num = e.currentTarget.getAttribute("data-optionNum");
            var color = "#AA0061";
            if(num === "1"){
                color = "#01AF40";
            } else if(num === "2"){
                color = "#F6B331"
            }
            hdr.style.backgroundColor = color;
            hdr.innerHTML = e.currentTarget.querySelector("span").innerHTML;
        }

        if(audio){
            self.hasAudio = true;
            lnx.audio.playAudio(audio);
        }

        self.popUp.querySelector(".popBody > div").innerHTML = e.currentTarget.querySelector(".target").innerHTML;
        var video = self.popUp.querySelector("video");
        if(video){
            self.vidLink = self.popUp.querySelector("p>span.underline");
            self.videoDiv = self.popUp.querySelector("div.vidOverlay");
            self.vidLink.onclick = function(e){
                lnx.audio.stopAudio();
                self.videoDiv.style.display = "block";
                video.play();
            }
            self.vidClose = self.popUp.querySelector(".videoClose");
            self.vidClose.onclick = function(e){
                self.videoDiv.style.display = "none";
                video.pause();
            }

        }
        self.popUp.style.display = "block";
        self.popUp.focus();       
                    
        e.stopPropagation ? 
        e.stopPropagation() : ( e.cancelBubble = true );
        
        e.preventDefault ?
        e.preventDefault() : ( e.returnValue = false );
        return false;
        
    },    
    
    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){
        
        lnx.util.updateEventListener(this.items, "click", this.onSelection, true);
        lnx.util.updateEventListener(this.popUpClose, "click", this.handlers[0], true);
        lnx.util.updateEventListener(this.popUnderlay, "click", this.handlers[1], true);
        lnx.util.updateEventListener(this.navBtns, "click", this.handlers[2], true);
        this.current = this.imgRefPref = this.popUp = this.popUnderlay = this.popUpClose = null;
        this.items = []; 
        this.handlers = [];
        this.navBtns = [];
        this.props = [];
        this.hasAudio = false;
    }
};

lnx.scenarioWithVirtualScreens = {

    items : [],
    id: null,
    scenario: null,
    stage: 0,
    type: null,
    resultShown: false,
    audio: [],
    delayAudio: null,
    cancelTimeout: null,
	complete: false,

    init: function(node, screenElm, frameElm){

        var self = this;
        this.resultShown = false;
        this.id = screenElm.getAttribute("id");
        this.stage = 1;
        this.type = screenElm.querySelectorAll(".vsPanel").length === 2 ? 1 : 2;
        this.scenario = screenElm.querySelector(".vContainer");
        addAudio();
        this.setUpScenario(this.scenario);


        function addAudio(){
            self.audio.push(screenElm.getAttribute("data-audio"));
            var a = screenElm.querySelectorAll("[data-audio]");
            for(var i=0;i<a.length;i++){
                self.audio.push(a[i].getAttribute("data-audio"));
            }
            a = screenElm.querySelector("[data-delayAudio]");
            if(a){
                self.delayAudio = a.getAttribute("data-delayAudio");
            }
        }
    },
        
        
    setUpScenario: function(scenario){

        lnx.audio.playAudio(this.audio[0]);
        var type = this.type;
        var self = this;
        var isBut = true;
        var isMultiSubmit = null;
        var isBinaryNonBut = false;
        var a = scenario.querySelectorAll(".vsBut"),
            self = this;
        if(a && !a.length){
            // must be non-button responses
            isBut = false;
            a = scenario.querySelectorAll(".vsAns");
            isMultiSubmit = scenario.querySelector(".vsSubmit");
        }        

        for(var i=0;i<a.length;i++){
            a[i].onclick = onClick;
        }

        this.items = a;

        if(isMultiSubmit){
            isMultiSubmit.onclick = onClick;
            if(a.length === 2 || scenario.querySelector(".vsSingleSelect")){
                isBinaryNonBut = true;
            }
            this.items[this.items.length] = isMultiSubmit;
        }        
        
        var selected;

        adjustHeight();

        function adjustHeight() {

            var p2 = scenario.querySelector(".vsPanel2");
            if(!p2){
                return;
            }
            var d1 = p2.childNodes[0];
            var d2 = p2.childNodes[1];               
            
            var ans = d2.querySelectorAll(".vsAns");
            if (!ans.length) {
                return;
            }

            var sub = d2.querySelector(".vsSubmit");
            if (sub) {
                var subPosition = window.getComputedStyle(sub).position;
                sub.style.position = "static";
            }

            var pad = parseInt(window.getComputedStyle(ans[0]).paddingTop);
            if (isNaN(pad)) {
                pad = 0;
            }
            var fs = parseInt(window.getComputedStyle(ans[0]).fontSize);
                        
            var i = 0;
            var startOnFont = false;
            while (is2High() && (++i < 20)) {
                pad = pad - 2;
                if ((pad < 14) && !startOnFont) {
                    startOnFont = true;
                }
                if (pad > 3) {
                    reduceSize(ans, "paddingTop", pad);
                    reduceSize(ans, "paddingBottom", pad);
                }
                if (!is2High()) {
                    break;
                }
                if ((fs > 11) && startOnFont) {
                    fs = fs - 1;
                    reduceSize(ans, "fontSize", fs);
                }
            }            

            if (sub) {
                sub.style.position = subPosition;
            }

            function is2High() {
                var p2h = getH(p2);
                var d1h = getH(d1);
                var d2h = getH(d2);

                return (d1h + d2h) > p2h;

                function getH(elm) {
                    return parseInt(window.getComputedStyle(elm).height) +
                        parseInt(window.getComputedStyle(elm).paddingTop) +
                        parseInt(window.getComputedStyle(elm).paddingBottom);
                }                
            }          

            function reduceSize(elms, prop, val) {
                for (var i = 0; i < elms.length; i++) {
                    elms[i].style[prop] = val + "px";
                }
            }
        }

        function onClick(e){
            var isCorrect = false;
            if(isBut){
                isCorrect = e.currentTarget.getAttribute("data-iscorrect") === "true";
                var c = isBut ? "vsButSelected" : "vsAnsSelected";
                if(selected){                
                    selected.classList.remove(c);
                    if(!isBut){
                        selected.querySelector("span").classList.remove("vsAnsSpanSelected");
                    }
                }
                e.currentTarget.classList.add(c);
                if(!isBut){
                    e.currentTarget.querySelector("span").classList.add("vsAnsSpanSelected");
                }
                selected = e.currentTarget;
                var r = isCorrect ? 2 : 0;
                showResult(r, false);
            }else{
                if(e.currentTarget.classList.contains("vsSubmit")){
                    var oneTrue, oneFalse;
                    oneTrue = oneFalse = false;
                    for(var i=0;i<a.length;i++){
                        if(a[i].getAttribute("data-iscorrect")){
                            if(a[i].classList.contains("vsAnsSelected")){
                                oneTrue = true;
                            }else{
                                oneFalse = true;
                            }
                        }else{
                            if(a[i].classList.contains("vsAnsSelected")){
                                oneFalse = true;
                            }
                        }
                    }
                    if(oneTrue && !oneFalse){
                        showResult(2);
                    } else if(oneTrue && oneFalse){
                        showResult(1);
                    } else {
                        showResult(0);
                    }
                }else if(isBinaryNonBut){
                    var c = isBut ? "vsButSelected" : "vsAnsSelected";
                    if(selected){                
                        selected.classList.remove(c);
                        if(!isBut){
                            selected.querySelector("span").classList.remove("vsAnsSpanSelected");
                        }
                    }
                    e.currentTarget.classList.add(c);
                    if(!isBut){
                        e.currentTarget.querySelector("span").classList.add("vsAnsSpanSelected");
                    }
                    selected = e.currentTarget;
                }else{
                    e.currentTarget.classList.toggle("vsAnsSelected");
                    e.currentTarget.querySelector("span").classList.toggle("vsAnsSpanSelected");
                }
            }            
        }

        function showResult(r){

            lnx.audio.stopAudio();
            var p3 = scenario.querySelector(".vsPanel3");
            var cor = p3.querySelector(".vsCorrect");
            var nCor = p3.querySelector(".vsNotCorrect");
            var pCor = p3.querySelector(".vsPartCorrect");
            var audioIdx = self.type === 2 ? 2 : 1;

            if(r === 2){
                cor.style.display = "block";
                nCor.style.display = "none";
                if(pCor) pCor.style.display = "none";
            }else if(r === 1){
                if(pCor) pCor.style.display = "block";
                nCor.style.display = "none";
                cor.style.display = "none";
                audioIdx = self.type === 2 ? 4 : 3;
            }else{
                nCor.style.display = "block";
                if(pCor) pCor.style.display = "none";
                cor.style.display = "none";
                audioIdx = self.type === 2 ? 3 : 2;
            }

            var sel = ".vsFeedback";
            var incorFb = p3.querySelector(".vsFeedback2");
            if(incorFb){                
                if(r !== 2){
                    p3.querySelector(".vsFeedback").style.display = "none";
                    incorFb.style.display = "block";
                }else{
                    p3.querySelector(".vsFeedback").style.display = "block";
                    incorFb.style.display = "none";
                }
            }else{
                p3.querySelector(".vsFeedback").style.display = "block";
            }
            
            self.stage = (self.type === 1) ? 2 : 3;

            lnx.audio.playAudio(self.audio[audioIdx]);
            
            lnx.cache.setValue("complete", this.id, true); //comment out? 2020
            //lnx.view.onScreenComplete();

            if(self.delayAudio){
                clearTimeout(self.cancelTimeout);
                self.cancelTimeout = setTimeout(function(){lnx.audio.playAudio(self.delayAudio)}, 2750);
            }            
            
            if(self.resultShown) return;

            var p2 = scenario.querySelector(".vsPanel2");
            var t = new TimelineMax(); 
            if(type === 2){
                t.to(p2, .9, {left : "-=496px"});
            }          
            t.to(p3, .9, {left : "-=434px"}, .5);
            self.resultShown = true;
        }

    },

    hasContent : function(){
        if(this.initialized){
            return true;
        } else {
            return false;
        }
    },

    updateVirtualScreen: function(num, dir){        
        var id = this.id;
        slidePanel("-413px", .8);
        this.stage = 2;
        
         function slidePanel(val, time){
            var vc = document.querySelector("#" + id + " .vContainer");
            var tl = new TimelineMax();
            tl.to(vc, time, {left : val});
        }        
    },

    insertVirtualScreen: function(dir){
        if(this.type === 2){
           if(dir === "next" && this.stage === 1){
                lnx.audio.stopAudio();
                this.updateVirtualScreen(dir);
                lnx.audio.playAudio(this.audio[1]);
                return true;
           }else if(dir === "prev" && this.stage === 3){
                this.returnToStart(3);
                return true;
            }else if(dir === "prev" && this.stage === 2){
                this.returnToStart(2);                
                return true;
            }else{
                return false;
            }
        }else{
            return false;
        }
    },

    isFinalScreen: function(){
        return this.resultShown;
    },

    waitForUnlock: function(){
        return this.type === 1;
    },

    onAudioComplete: function(){

    },

    returnToStart: function(st){

        if(st === 3){
            var p3 = this.scenario.querySelector(".vsPanel3");
            var cor = p3.querySelector(".vsCorrect");
            var nCor = p3.querySelector(".vsNotCorrect");
            var pCor = p3.querySelector(".vsPartCorrect");
            
            cor.style.display = "none";
            nCor.style.display = "none";
            if(pCor) pCor.style.display = "none";

            var fb = p3.querySelector(".vsFeedback");
            fb.style.display = "none";        
            
            var p2 = this.scenario.querySelector(".vsPanel2");
            var t = new TimelineMax();
            t.to(p3, .9, {left : "+=434px"});            
            t.to(this.scenario, .9, {left : "+=434px"}, .9);
            t.to(p2, .9, {left : "+=496px"}, 1.8);
        }else{
            //var p2 = this.scenario.querySelector(".vsPanel2");
            var t = new TimelineMax();           
            t.to(this.scenario, .9, {left : "+=434px"});
            //t.to(p2, .9, {left : "+=496px"}, 1.8);
        }

        this.stage = 1;
        this.resultShown = false;
        var a = this.items;
        for(var i=0;i<a.length;i++){
            a[i].classList.remove("vsButSelected");
            a[i].classList.remove("vsAnsSelected");
            a[i].firstChild.classList.remove("vsAnsSpanSelected");
        }
        this.selected = null;
        clearTimeout(this.cancelTimeout);
        lnx.audio.playAudio(this.audio[0]);
    },

    isComplete: function(){
        return lnx.cache.getValue("complete", this.id);    
    },

    destroy : function(newType, navId){   
        if(navId === this.id){
            return;        
        }        
        this.removeHandlers();
        this.audio = [];
        clearTimeout(this.cancelTimeout);
		this.resultShown = false;
    },

    removeHandlers: function(){
        var a = this.items;
        for(var i=0;i<a.length;i++){
            a[i].onclick = null;
        }
        this.items = [];
    }
}; 

lnx.verticalScenario = {

    items : [],
    id: null,
    scenario: null,
    stage: 0,
    type: null,
    resultShown: false,
    audio: [],
    delayAudio: null,
    cancelTimeout: null,
    complete: false,
    screenAnims: [],
    timelines: null,

    init: function(node, screenElm, frameElm){
        
        var self = this;
        this.resId = node.getAttribute("resId");
        this.skipFirst = node.getAttribute("skipFirst") === "true";
        this.resultShown = false;
        this.id = screenElm.getAttribute("id");
        this.vScreens = screenElm.querySelectorAll(".scenarioVerticalScreen");
        this.vPanel = screenElm.querySelector(".scenarioVerticalPanel");
        this.dummyPanel = screenElm.querySelector(".vsDummyPanel");
        this.stage = 1;
        this.screenAnims = [];
        this.timelines = [];
        var b = this.buttons = [];

        // var vr = screenElm.querySelectorAll(".scenarioVericalResult > div");
        // for(var i = 0; i < vr.length; i++){
        //     lnx.util.stopHOverflow(vr[i]);
        // }        

        this.createAnims();
        setupQuiz();  
        this.playAudio(this.stage);

        function setupQuiz(){
            b = b.concat(Array.prototype.slice.call(screenElm.querySelectorAll(".vs2Ans")));
            b.push(screenElm.querySelector(".vs2But"));

            for(var i=0; i<b.length; i++){
                b[i].onclick = onClick;
            }
        }        

        function onClick(e){
            var isCorrect = 0;
            var isSubmit = false;
            var t = e.currentTarget;
            if(t.classList.contains("vs2But")){
                isSubmit = true;
                for(var i=0; i<b.length; i++){
                    if(b[i].getAttribute("data-iscorrect") === "true"){
                        if(b[i].querySelector("input").checked){
                            isCorrect = 1;                        
                            break;
                        }                        
                    }
                }
            } else {
                var r = t.querySelector("input");
                if(r){
                    r.checked = true;
                }
            }
            if(isSubmit){
                showResult(isCorrect)
            }           
        }

        function showResult(isCorrect){
            var screen = self.vScreens[2];
            var resultPlate = screen.querySelector(".vs2ResultColor");
            var res = screen.querySelectorAll(".scenarioVericalResult > div");
            var fb = screen.querySelectorAll(".vs2Feedback");
            self.resultShown = true;
            for(var i = 0; i < res.length; i++){
                res[i].style.display = (i === isCorrect) ? "block" : "none";
                if(fb.length > 1 && i < 2){
                    fb[i].style.display = (i === isCorrect) ? "block" : "none";
                }
            }          
            var audioFile = "Correct";
            if(isCorrect === 1){
                resultPlate.classList.remove("scenarioVerticalNonCorrect");
            } else {
                resultPlate.classList.add("scenarioVerticalNonCorrect");
                audioFile = "Not_Correct";
            }
            if(self.stage === 3){
                self.playAudio(audioFile, 250);
                // user is just re submitting answer, do nothing
                return;
            }
            self.playAudio(audioFile, 750);
            self.insertVirtualScreen("next", "isSubmit");
        }
    },

    playAudio: function(id, delay){
        var file = typeof(id) === "number" ? this.resId + "_" + id : id;        
        lnx.audio.playAudio(file, delay);
    },

    createAnims: function(){
        //screen 1
        var t1 = gsap.timeline();
        var anims = [];
        anims.push(this.vScreens[0]);
        anims = anims.concat(Array.prototype.slice.call(this.vScreens[0].querySelectorAll(".anim")));
        t1.from(anims[0], {duration:1.1, y:"+=30rem"})
            .from(anims[1], {duration:.7, y:"+=2.5rem", opacity:0}, "-=.3") 
            .from(anims[5], {duration:1, x: "+=2.5rem", opacity:0}, "-=.3")           
            .from(anims[2], {duration:.5, y: "-=2.5rem", opacity:0}, "-=.6")
            .from(anims[3], {duration:.6, y: "-=2.5rem", opacity:0}, "-=.2")
            .from(anims[4], {duration:.7, y: "-=2.5rem", opacity:0}, "-=.2")
            ;

        
        this.timelines.push(t1);

        //screen 2
        var t2 = gsap.timeline({paused:true});
        anims = [];
        anims.push(this.vScreens[1]);
        anims = anims.concat(Array.prototype.slice.call(this.vScreens[1].querySelectorAll(".anim")));
        anims.push(this.vPanel);
        anims.push(this.vPanel.firstElementChild);
        t2.to(anims[0], {duration:0, zIndex:"auto"})
            .to(anims[6], {duration:0, display:"block"})
            .to(anims[0], {duration:1.1, y:"-=30rem"})            
            .from(anims[1], {duration:.7, y:"+=1.25rem", opacity:0}, "-=.3")
            .to(anims[2], {duration:.7, rotateZ:"-=30deg", transformOrigin: "50% 100%"}, "-=.5")
            .from(anims[4], {duration:.7, y:"+=1.875rem", opacity:0}, "-=.5")
            .to(anims[5], {duration:.7, rotateZ:"+=30deg", transformOrigin: "50% 100%"}, "-=.5")
            .fromTo(anims[7], {opacity:0, x:"+=1.875rem"}, {x:"0", duration:.7, opacity:1}, "-=.35")
            .from(anims[3], {duration:.7, y:"+=2.5rem", opacity:0}, "-=.3")
            ;

        if(this.skipFirst){
            t1.pause();
            t1.seek(t1.duration());
            this.stage = 2;
            t2.play();
        }
        this.timelines.push(t2);

        //screen 3
        var t3 = gsap.timeline({paused:true});
        anims = [];
        anims.push(this.vScreens[2]);
        anims = anims.concat(Array.prototype.slice.call(this.vScreens[2].querySelectorAll(".anim")));
        anims.push(this.vPanel);
        anims.push(this.vPanel.firstElementChild);
        anims.push(this.dummyPanel);
        t3.to(anims[0], {duration:0, zIndex:"auto"})
            .to(anims[0], {duration:1.1, y:"-=30rem"})
            .to(anims[4], {duration:1.1, y:"-=30rem"}, "<")
            .to(anims[4], {duration:0, display:"none"}, "-=.2")
            .fromTo(anims[3], {opacity:0, x: "+=4.375rem"}, {duration:.9, opacity:1, x: "-=2.5rem", immediateRender:false}, "<")
            .from(anims[1], {duration:.7, opacity:0, x: "-=2.5rem"}, "-=.5");

        this.timelines.push(t3);
    },

    hasContent : function(){
        if(this.initialized){
            return true;
        } else {
            return false;
        }
    },

    updateVirtualScreen: function(dir){ 
        if(dir === "next"){
            this.timelines[this.stage-1].play();            
        } else {
            this.timelines[this.stage].reverse();
        }        
        if(this.stage < 3){
            var delay = this.stage === 2 ? 850 : 0;
            this.playAudio(this.stage, delay);
        }
    },

    insertVirtualScreen: function(dir, isSubmit){
        var limit = 1;
        if(this.skipFirst){
            limit = 2;
        }
        var result = true;
        var nextStage = dir === "next" ? ++this.stage : --this.stage;
        if(nextStage < limit || nextStage > 3){
            result = false;
        } else if (dir === "next" && nextStage === 3 && isSubmit !== "isSubmit"){
            result = false;
        } 
        else {
            this.updateVirtualScreen(dir); 
        }
        return result;
    },   

    isComplete: function(){
        return lnx.cache.getValue("complete", this.id);    
    },

    isFinalScreen: function(){
        return this.resultShown;
    },

    destroy : function(newType, navId){   
        if(navId === this.id){
            return;        
        }        
        this.removeHandlers();
        this.audio = [];
        clearTimeout(this.cancelTimeout);
        this.resultShown = false;
    },

    removeHandlers: function(){
        var a = this.items;
        for(var i=0;i<a.length;i++){
            a[i].onclick = null;
        }
        this.items = [];
    }
}; 

lnx.stages = {

    items : [],
    id: null,
    scenario: null,
    stage: 0,
    type: null,
    resultShown: false,
    audio: [],
    delayAudio: null,
    cancelTimeout: null,
    complete: false,
    screenAnims: [],
    timelines: null,

    init: function(node, screenElm, frameElm, origNavId){
        
        var self = this;
        this.resId = node.getAttribute("resId");
        this.resultShown = false;
        this.id = screenElm.getAttribute("id");
        this.stages = screenElm.querySelectorAll("div.stages > div.stage");
        this.stage = 1;
        this.container = screenElm.querySelector("#arrowContainer");
        this.timelines = [];
          
        this.createAnims();
        
        if(origNavId === "prev"){
            // must be reversing into activity so show last virtual screen
            this.stage = this.stages.length;
            this.insertVirtualScreen("prev", true);
        }
        this.stages[this.stage - 1].style.display = "block";  
        this.playAudio(this.stage);

    },

    playAudio: function(id, delay){

        var file = typeof(id) === "number" ? this.resId + "_" + id : id;        
        lnx.audio.playAudio(file, delay);
    },

    createAnims: function(){

        var arrows = Array.prototype.slice.call(this.container.querySelectorAll("#arrowContainer > div.arrow"));
        var arw4Img = arrows[3].querySelector("img");
        var imageCon = this.container.querySelector("#arrowContainer > div.images");
        var images = imageCon.querySelectorAll("img");
        var stagesCon = this.container;
        var subs = stagesCon.querySelectorAll("div.arrow  ul > li");        
        var bgColor = "#B64068"; //windows.getComputedStyle(arrows[3]).backgroundColor;
    
        //screen 1
        var t1 = gsap.timeline({paused:false});
        t1.from(arrows[0], {duration:.6, x:"-3.75rem", opacity:0})
            .from(arrows[1], {duration:.6, x:"-3.75rem", opacity:0}, "-=.4")
            .from(arrows[2], {duration:.6, x:"-3.75rem", opacity:0}, "-=.3")
            .from(arrows[3], {duration:.6,x:"-3.75rem", opacity:0}, "-=.2")
            .to(imageCon, {duration: 0, display:"block"})
            ;
        this.timelines.push(t1);   
    
        //screen 2
        var t2 = gsap.timeline({paused:true, defaults: {immediateRender:false}});       
        t2.to(arrows, {duration:0, x: 0})
            .to(arrows[3], {duration:3, x:"-60.625rem", ease: "sine.in"})
            .to(arrows[2], {duration:2, x:"-48.875rem", ease: "power1.in"}, 1.3)            
            .to(arrows[1], {duration:1, x:"-31.25rem", ease: "power1.in"}, 2.3)
            .to(subs, {duration: .75, opacity: 0}, "-=1.5")
            ;
        this.timelines.push(t2);
      
        //screen 3
        var t3 = gsap.timeline({paused:true, defaults: {immediateRender:false}}); 
        t3.to(images[9], {duration:1, opacity:0})
            .from(subs[0], {duration:.7, x:"-6.25rem"}, "-=.6")
            .to(subs[0], {duration:.7, opacity:1}, "<")
            ;
        this.timelines.push(t3);
    
        //screen 4
        var t4 = gsap.timeline({paused:true, defaults: {immediateRender:false}}); 
        t4.to(images[8], {duration:1, opacity:0})
            .from(subs[1], {duration:.7, x:"-6.25rem"}, "-=.6")
            .to(subs[1], {duration:.7, opacity:1}, "<")            
            ;
        this.timelines.push(t4);
      
        //screen 5
        var t5 = gsap.timeline({paused:true, defaults: {immediateRender:false}}); 
        t5.to(subs, {duration: 0, opacity: 0})
            .to(stagesCon, {duration:0, opacity:0})
            .to(images[7], {duration:0, opacity:0})
            .to(arrows, {duration:0, x: 0}) 
            .to(stagesCon, {duration:.6, opacity:1})
            .to(arrows[3], {duration:1.6, x:"-60.625rem", ease: "sine.in"})
            .to(arrows[2], {duration:1.4, x:"-48.875rem", ease: "power1.in"}, 1.42)   
            .to(arrows[1], {duration:1, x:"-15.625rem", ease: "power1.in"}, 2.24)    
            .to(arrows[0], {duration:1, x:"-15.625rem", ease: "power1.in"}, "<")              
            ;
        this.timelines.push(t5);       
    
        //screen 6
        var t6 = gsap.timeline({paused:true, defaults: {immediateRender:false}}); 
        t6.to(images[6], {duration:1, opacity:0})
            .from(subs[2], {duration:.7, x:"-6.25rem"}, "-=.6")
            .to(subs[2], {duration:.7, opacity:1}, "<")
            ;
        this.timelines.push(t6);
    
        //screen 7
        var t7 = gsap.timeline({paused:true, defaults: {immediateRender:false}}); 
        t7.to(images[5], {duration:1, opacity:0})
            .from(subs[3], {duration:.7, x:"-6.25rem"}, "-=..6")
            .to(subs[3], {duration:.7, opacity:1}, "<")
            ;
        this.timelines.push(t7);
        
        //screen 8
        var t8 = gsap.timeline({paused:true, defaults: {immediateRender:false}}); 
        t8.to(subs, {duration: 0, opacity: 0})
            .to(stagesCon, {duration:0, opacity:0})
            .to(images[4], {duration:0, opacity:0})
            .to(arrows, {duration:0, x: 0}) 
            .to(stagesCon, {duration:.6, opacity:1})
            .to(arrows[3], {duration:1.6, x:"-60.625rem", ease: "sine.in"})
            .to(arrows[2], {duration:1.4, x:"-30.4375rem"}, 1.41)   
            .to(arrows[1], {duration:1.4, x:"-30.4375rem"}, "<")    
            .to(arrows[0], {duration:1.4, x:"-30.4375rem"}, "<")                        
            ;
        this.timelines.push(t8);        //GSDevTools.create({animation: t8});
    
        //screen 9
        var t9 = gsap.timeline({paused:true, defaults: {immediateRender:false}}); 
        t9.to(images[3], {duration:1, opacity:0})
            .from(subs[4], {duration:.7, x:"-6.25rem"}, "-=.6")
            .to(subs[4], {duration:.7, opacity:1}, "<")
            ;
        this.timelines.push(t9);
    
        //screen 10
        var t10 = gsap.timeline({paused:true, defaults: {immediateRender:false}}); 
        t10.to(subs, {duration: 0, opacity: 0})
            .to(stagesCon, {duration:0, opacity:0})
            .to(images[2], {duration:0, opacity:0})
            .to(arrows, {duration:0, x: 0}) 
            .to(stagesCon, {duration:.6, opacity:1})
            .to(arrows[3], {duration:1.6, x:"-45.6875rem"})
            .to(arrows[2], {duration:1.6, x:"-45.6875rem"}, "<")   
            .to(arrows[1], {duration:1.2, x:"-34.375rem"}, "<")    
            .to(arrows[0], {duration:.8, x:"-15.625rem"}, "<")  
            .to(arrows[3], {duration:.2, backgroundColor:"transparent"}, "-=1.4")      
            //.to(arw4Img, {duration:0, src:"images/arrow4b.png"}, "-=.4")         
            ;
        this.timelines.push(t10);
    
        //screen 11
        var t11 = gsap.timeline({paused:true, defaults: {immediateRender:false}}); 
        t11.to(images[1], {duration:1, opacity:0})
            .from(subs[5], {duration:.7, x:"-6.25rem"}, "-=.6")
            .to(subs[5], {duration:.7, opacity:1}, "<")
            ;
        this.timelines.push(t11);
    
        //screen 12
        var t12 = gsap.timeline({paused:true, defaults: {immediateRender:false}}); 
        t12.to(subs, {duration: 0, opacity: 1})
            .to(stagesCon, {duration:0, opacity:0})
            .to(arrows, {duration:0, x: 0}) 
            .to(stagesCon, {duration:1, opacity:1})
            .to(arrows[3], {duration:.0, backgroundColor: bgColor}, 0)  
            //.to(arw4Img, {duration:0, src:"images/arrow4.png"}, "<") 
            // .to(subs[0], {duration:.4, scale:1.3, transformOrigin: "50% 100%"}, 11.5)
            // .to(subs[0], {duration:.4, scale:1, transformOrigin: "0% 100%"}, 11.9)
            ;
        this.timelines.push(t12);
    },

    hasContent : function(){
        if(this.initialized){
            return true;
        } else {
            return false;
        }
    },

    updateVirtualScreen: function(dir, isReverse){ 
        
        if(isReverse){
            //nothing to do
            return;
        }

        for(var i = 0; i < this.stages.length; i++){
            if((this.stage - 1) === i){
                this.stages[i].style.display = "block";                
            } else {
                 this.stages[i].style.display = "none";      
            }
        }
        var tl;
        if(dir === "prev"){
            // tl = this.timelines[this.stage];
            // if(tl){
            //     tl.kill();
            // }
            this.timelines[this.stage].reverse();
        } else {            
            tl = this.timelines[this.stage];
            if(tl){
               tl.kill(); //seek(tl.duration())
            }
           tl = this.timelines[this.stage-1];
           tl.play();
        }
        this.playAudio(this.stage);
    },

    insertVirtualScreen: function(dir, isReverse){
        var result = false;
        if(dir === "next"){ 
            if(this.stage < 12){
                this.stage++;
                result = true;
            }
        } else {
            if(this.stage > 1){
                if(!isReverse){
                    this.stage--;
                }                
                result = true;
            }
        }
        if(result){
            this.updateVirtualScreen(dir, isReverse); 
        }
        return result;        
    },   

    isComplete: function(){
        return lnx.cache.getValue("complete", this.id);    
    },

    isFinalScreen: function(){
        return this.resultShown;
    },

    destroy : function(newType, navId){   
        if(navId === this.id){
            return;        
        } 
        this.audio = [];
        clearTimeout(this.cancelTimeout);
        this.resultShown = false;
    }
}; 

lnx.dialogueWithVirtualScreens = {

    items : [],
    id: null,
    stage: null,
    audio: [],
    numScreens: null,
    nodeId: null,

    init: function(node, screenElm, frameElm, origNavId){

        var SCREENWIDTH = 58.13;
        var self = this;
        var audioDelay = 600;
        this.complete = false;
        this.id = screenElm.getAttribute("id");
        this.resId = node.getAttribute("resId");
        var vc = document.querySelector("#" + this.id + " .dialogueContainer");
        if(!vc){
            vc = document.querySelector("#" + this.id + " .newsContainer");
        }
        this.numScreens = vc.querySelectorAll(".newsScreen").length;
        vc.style.width = (this.numScreens * SCREENWIDTH)  + "rem";

        //this.numScreens = parseInt(screenElm.getAttribute("data-numScreens"));
        this.stage = 1;
        addAudio();

        var audioIdx = 0;
        if(origNavId === "prev"){
            // must be reversing into activity so show last virtual screen
            this.insertVirtualScreen("prev", true);
            audioIdx = this.audio.length - 1;
        }
        lnx.audio.playAudio(this.audio[audioIdx]);

        var elms = screenElm.querySelectorAll("div.newsScreen > div");
        for(var i = 0; i< elms.length;i++){
            //lnx.util.stopVOverflow(elms[i]);
        }

        function addAudio(){
            self.audio = [];
            var a = Array.from(screenElm.querySelectorAll("[data-audio]"));
            for(var i=0;i<a.length;i++){
                self.audio.push(a[i].getAttribute("data-audio"));
            }
        }
    },

    getResId: function(){
        return this.resId + "_" + this.stage;
    },

    hasContent : function(){
        if(this.initialized){
            return true;
        } else {
            return false;
        }
    },

    updateVirtualScreen: function(dir, showFinalReverse){
        var screenWidth = 58.13;
        var vc = document.querySelector("#" + this.id + " .dialogueContainer");
        if(!vc){
            vc = document.querySelector("#" + this.id + " .newsContainer");
        }
        var tl = new TimelineMax();
        var multiplier = this.stage-1;
        var val = screenWidth * multiplier;
        var interval = 1.6;
        if(showFinalReverse){
            //only want to animate from just before final screen if reversing
             //vc.style.left = "-" + ((screenWidth * this.stage) - (screenWidth/2)) + "px";
             interval = 0;
        }  
       
        var sign = val === 0 ? "" : "-" ;
        val = sign + val + "rem";        
        tl.to(vc, interval, {x : val});
    },

    insertVirtualScreen: function(dir, showFinalReverse){        
        if(showFinalReverse){
            this.stage = this.numScreens + 1;
            // stage will be decrimented to correct value below in "prev" conditional
        }
        var audioDelay = 1500;
       if(dir === "next"){
            if(this.stage < this.numScreens){
                this.stage++;
                lnx.audio.stopAudio();
                this.updateVirtualScreen(dir);
                lnx.audio.playAudio(this.audio[this.stage-1], audioDelay);
                //check are we now on last screen
                if(!((this.stage + 1) < this.numScreens)){

                }
                return true;
            }else{
                this.complete = true;
                return false;
            }
       }else if(dir === "prev"){
            if(this.stage < 2){
                return false;
            }else{
                this.stage--;
                lnx.audio.stopAudio();
                this.updateVirtualScreen(dir, showFinalReverse);
                lnx.audio.playAudio(this.audio[this.stage-1], audioDelay);
                return true;
            }       
        }else{
            return false;
        }
    },

    isComplete: function(){
        return lnx.cache.getValue("complete", this.id);
    },

    isFinalScreen: function(){
        return (this.stage >= this.numScreens)
    },

    getStillHasScreens: function(){
        return !this.complete;
    },

    destroy : function(newType, navId){   
        if(navId === this.id){
            return;        
        }        
        this.stage = null;
        this.audio = [];
        this.resId = this.id = null;
    }

};

lnx.hasVirtualScreenOverlay = {

    items : [],
    id: null,
    inOp: false,

    init: function(node, screenElm, frameElm){
        var b = screenElm.querySelector(".bullBtn"),
            t = screenElm.querySelector(".bullText"),
            self = this;
        if(!b) return;
        b.onclick = onClick;
        this.items.push(b);
        this.id = screenElm.getAttribute("id");

        function onClick(e){
            self.inOp = true;
            self.registerAccess(t);
        }

    },

    registerAccess: function(t){
        lnx.overlayMan.show(t.innerHTML);
        lnx.cache.setValue("complete", this.id, true);
        lnx.view.onScreenComplete();
    },

    hasContent : function(){
        
        return false;
    },

    insertVirtualScreen: function(){
        // Abbott want this to always display
        //if(lnx.cache.getValue("complete", this.id)) return false;
        if(this.inOp){
            this.inOp = true;
            return false;
        }        
        this.items[0].onclick();
        return true;
    },

    isComplete: function(){
    	return lnx.cache.getValue("complete", this.id);    
    },

    destroy : function(){  
        this.items[0].onclick = null;
        this.items = [];
        this.id = null;
        this.inOp = false;
    }
};

lnx.acknowledge = {

    items : [],

    init: function(node, screenElm, frameElm){
        
        lnx.util.updateEventListener( document.getElementById("ackBtn"), "click", this.onAcknoledge);
        this.items[0] = screenElm.querySelector(".ackInstruction");  
        this.items[1] = screenElm.querySelector(".ackBoxInner");
        this.items[2] = screenElm.querySelector(".ackBoxCongrat");
        this.items[3] = screenElm.getAttribute("data-audioCongrat");
    },

    onAcknoledge: function(e){
        var self = lnx.acknowledge;
        var r = lnx.scormApi.lmsCompleteCourse(true);
        if(r){
            self.items[0].innerHTML = "&nbsp;";
            self.items[1].innerHTML = self.items[2].innerHTML;
             lnx.audio.playAudio(self.items[3]);
        }
    },

    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){  
        
        this.items = [];
    }

};

lnx.autoVideo = {

    items : [],

    init: function(node, screenElm, frameElm){
        
        try{
            screenElm.querySelector(".autoVideo5").play();
        } catch(e){
            //
        }
    },


    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){  
        
        this.items = [];
    }

};


lnx.clickAndPopup = {
    
    items : [],
    imgRefPref: null,
    popUp: null,
    type: null,
    popUpClose: null,
    popUnderlay: null,
    handlers: [],    
    hasAudio: false,
    
    init : function( node, screenElm, frameElm ){
    
        var self = this;
        // get clickable items
        var set = screenElm.querySelectorAll("div.clickable");
        for(var i = 0, len = set.length; i < len; i++ ){
            this.items.push(set[i]);
        }
        this.complete = false;
        this.scrId = screenElm.getAttribute("id");  
        this.popUp = screenElm.querySelector(".popup");  
        this.popUpClose = this.popUp.querySelector("img.popupClose");
        this.popUnderlay = this.popUp.querySelector("div.popUnderlay");
        this.type = node.getAttribute("subType");
        if(this.type === "2"){
            this.imgRefPref = node.getAttribute("navId") + "_";
        }
        lnx.util.updateEventListener(this.items, "click", this.onSelection);   
        lnx.util.updateEventListener(this.popUpClose, "click", onClose);
        this.handlers.push(onClose);
        lnx.util.updateEventListener(this.popUnderlay, "click", onClickUnderlay);
        this.handlers.push(onClickUnderlay);

        this.message = screenElm.querySelector(".userNotice");

        function onClose(e){
            var self = lnx.clickAndPopup;   
            self.popUp.style.display = "none";
            if(self.type === "2"){
                self.popUp.querySelector("div.popHeader > img").src = "images/blackPx.gif";
            }
            if(self.hasAudio){
                lnx.audio.stopAudio();
            }            
        }

        function onClickUnderlay(e){
            if(e.target === e.currentTarget){
                onClose();
            }
        }     
    },
    
    OnNavEventRejectedNotice: function(dir){
        this.message.classList.add("showUserNotice");
    },
    
    onSelection : function( e ){
        
        e = e || window.event;
        var self = lnx.clickAndPopup;        
        self.message.classList.remove("showUserNotice");
        var num = e.currentTarget.getAttribute("data-optionNum");
        var audio = e.currentTarget.getAttribute("data-audio");
        e.currentTarget.setAttribute("data-complete", "true");
        e.currentTarget.querySelectorAll("img")[2].setAttribute("src", "images/greenComplete.svg");
        if(self.type === "2"){
            self.popUp.querySelector("div.popHeader > img").src = "images/" + self.imgRefPref + num + ".jpg";
        } else if(self.type === "3"){
            var hdr = self.popUp.querySelector(".popHeader");
            hdr.style.backgroundColor = window.getComputedStyle(e.currentTarget, null).backgroundColor;
            //hdr.innerHTML = e.currentTarget.querySelector("div>span").innerHTML;
            hdr.innerHTML = e.currentTarget.querySelector("div > p").innerHTML;
        } else if(self.type === "4"){
            var hdr = self.popUp.querySelector(".popHeader");
            var num = e.currentTarget.getAttribute("data-optionNum");
            var color = "#AA0061";
            if(num === "1"){
                color = "#01AF40";
            } else if(num === "2"){
                color = "#F6B331"
            }
            hdr.style.backgroundColor = color;
            hdr.innerHTML = e.currentTarget.querySelector("span").innerHTML;
        }

        if(audio){
            self.hasAudio = true;
            lnx.audio.playAudio(audio);
        }

        self.popUp.querySelector(".popBody").innerHTML = e.currentTarget.querySelector(" div.hide").innerHTML;
        self.popUp.style.display = "block";
        self.popUp.focus();     
        
        if(!self.complete){
            checkForCompletion();
        }
                    
        e.stopPropagation ? 
        e.stopPropagation() : ( e.cancelBubble = true );
        
        e.preventDefault ?
        e.preventDefault() : ( e.returnValue = false );
        return false;

        function checkForCompletion(){
            var complete = true;
            for(var i=0;i<self.items.length;i++){
                if(self.items[i].getAttribute("data-complete") !== "true"){
                    complete = false;
                    break;
                }
            }
            if(complete){
                self.complete = complete;
                lnx.cache.setValue("complete", self.scrId, true);
                lnx.view.onScreenComplete();
            }
            return complete;
        }
        
    },    

    onAudioFinish: function(){
        // presence required but doesn't need to do anything
    },
    
    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){
        
        lnx.util.updateEventListener(this.items, "click", this.onSelection, true);
        lnx.util.updateEventListener(this.popUpClose, "click", this.handlers[0], true);
        lnx.util.updateEventListener(this.popUnderlay, "click", this.handlers[1], true);
        this.current = this.imgRefPref = this.popUp = this.popUnderlay = this.popUpClose = null;
        this.items = []; 
        this.handlers = [];
        this.hasAudio = false;
    }
};

lnx.clickAndPopupSelection = {
    
    items : [],    
    pairs: [],
    handlers: [],
    popUp: null,    
    popUpClose: null,
    popUnderlay: null,
    
    init : function( node, screenElm, frameElm ){
    
        var self = this;
        var isType2 = this.isType2 = (node.getAttribute("subType") === "2");
        // get clickable items
        this.items = Array.prototype.slice.call(screenElm.querySelectorAll("div.clickable"));
        this.pairs = Array.prototype.slice.call(screenElm.querySelectorAll("div.selectionPair")); 

        this.popUp = screenElm.querySelector(".popup");  
        this.popUpClose = this.popUp.querySelector("img.popupClose");
        this.popUnderlay = this.popUp.querySelector("div.popUnderlay");

        lnx.util.updateEventListener(this.items, "click", this.onSelection);  
        lnx.util.updateEventListener(this.popUpClose, "click", onClose);
        this.handlers.push(onClose);
        lnx.util.updateEventListener(this.popUnderlay, "click", onClickUnderlay);
        this.handlers.push(onClickUnderlay);

        //show first pair
        this.pairs[0].style.display = "block";
        this.adjustSize();

        function onClose(e){
            self.popUp.style.display = "none";
            doAnimation(e);
            //self.nextPair();
        }

        function onClickUnderlay(e){
            if(e.target === e.currentTarget){
                onClose();
            }
        }

        function doAnimation(e){
            var img = self.pairs[0].querySelector("div.selectionPair > img");
            var y = self.pairs[0].getAttribute("data-answer") === "1" ? -60 : 110;
            var x = isType2 ? 280 : 500;
            y = isType2 ? 110 : y;
            var tl = new TimelineMax();            
            tl.to(img, .75, {scale : .3, x: x, y: y, onComplete: onAnimComplete}, '+=0.7');
            handleLastScreen();
        }

        function onAnimComplete(){
            if(self.pairs[0]){
                var img = self.pairs[0].querySelector("div.selectionPair > img");
                img.style.display = "none";
                self.nextPair();
            }
        }

        function handleLastScreen(){
            if(isType2 && self.pairs.length < 2){
                self.pairs[0].parentNode.classList.add("abSelectionsBtnsBgImg");
            }
        }
    },
    
    adjustSize: function(){
        if(this.isType2){
            var divs = this.pairs[0].querySelectorAll("div.abSelection");
            for(var i = 0; i < divs.length; i++){
                if(divs[i].scrollWidth > divs[i].clientWidth){
                    var sz = parseInt(getComputedStyle(divs[i].firstElementChild).fontSize);
                    while(sz > 11){
                        sz -= 1;
                        divs[i].firstElementChild.style.fontSize = (sz + "px");
                        if(divs[i].scrollWidth <= divs[i].clientWidth){
                            break;
                        }
                    }
                }
            }
        }
    },
    
    onSelection : function( e ){

        e = e || window.event;
        var self = lnx.clickAndPopupSelection;        
        var corAns = e.currentTarget.parentNode.getAttribute("data-answer");
        if(corAns === null){
            corAns = e.currentTarget.parentNode.parentNode.getAttribute("data-answer");
        }
        var isCorrect = false;
        if(corAns === e.currentTarget.getAttribute("data-optionNum")){
            isCorrect = true;
        }
        
        var img = isCorrect ? "popup_correct.png" : "popup_incorrect.png";    
        self.popUp.querySelector(".popHeader > img").src = "images/" + img;
        var sp = self.popUp.querySelector(".popHeader > span");
        sp.innerHTML = self.popUp.querySelectorAll("span")[isCorrect?0:1].innerHTML;
        sp.style.color = isCorrect ? "#5ADA4F" : "#cc0070";
       
        var elm =e.currentTarget.querySelector("div.target") || e.currentTarget.parentNode.querySelector("div.target");
        self.popUp.querySelector(".popBody").innerHTML = elm.innerHTML;
        self.popUp.style.display = "block";
        self.popUp.focus();       

        lnx.audio.stopAudio();
        lnx.audio.playAudio(isCorrect ? "Correct" : "NotCorrect");
                    
        e.stopPropagation ? 
        e.stopPropagation() : ( e.cancelBubble = true );
        
        e.preventDefault ?
        e.preventDefault() : ( e.returnValue = false );
        return false;        
    },

    nextPair: function(){        
        if(this.pairs.length < 2){ 
            // exercise over
            var len = this.items.length;
            for(var i = 0; i < len; i++ ){
                lnx.util.updateEventListener( this.items[i], "click", this.onSelection, true); 
                this.items[i].classList.remove("clickable");
            }
            var elm = this.pairs[0].parentNode.querySelector(".endMessage");
            var audio = elm.getAttribute("data-audio");
            if(audio){
                lnx.audio.playAudio(audio);
            }
            this.pairs[0].querySelector(".blueBox").innerHTML = elm.innerHTML;
        } else {                        
            this.pairs[0].style.display = "none";
            this.pairs.shift();            
            this.pairs[0].style.opacity = 0;    
            this.pairs[0].style.display = "block";

            var audio = this.pairs[0].getAttribute("data-audio");
            if(audio){
                lnx.audio.playAudio(audio);
            }
            var tl = new TimelineMax();               
            tl.to(this.pairs[0], .75, {opacity : 1});
            this.adjustSize();
        }
    },    
    
    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){
        
        lnx.util.updateEventListener(this.items, "click", this.onSelection, true);        
        lnx.util.updateEventListener(this.popUpClose, "click", this.handlers[0], true);
        lnx.util.updateEventListener(this.popUnderlay, "click", this.handlers[1], true);
        this.current = this.popUp = this.popUpClose = this.popUnderlay = null;
        this.items = []; 
        this.pairs = [];
        this.handlers = [];
    }
};

lnx.videoScenario = {

    options : [],
    correctAns: [],
    resultDiv: null,       
    
    init : function( node, screenElm, frameElm ){

        var self = this;
        var resultOpen = false;
        this.options = Array.prototype.slice.call(screenElm.querySelectorAll(".scenarioRight > div"));        
        this.displayDivs = screenElm.querySelectorAll("div.videoScenario > div");
        this.correctAns = screenElm.getAttribute("data-correctAnswer").split(",");
        var audio = screenElm.getAttribute("data-audio");
        lnx.util.updateEventListener( this.options, "click", onSelection);

        this.vid = screenElm.querySelector("video");
        lnx.util.updateEventListener( this.vid, "ended", onVideoEnd);
        this.vid.play();
        slideInPanels();  

        function onVideoEnd(e){
            lnx.audio.playAudio(audio);   
        }

        function slideInPanels(){
            var tl = new TimelineMax();    
            var left = parseInt(window.getComputedStyle(self.displayDivs[0]).left) + 310;
            tl.to(self.displayDivs[0], 2, {left : left});
            var tl2 = new TimelineMax(); 
            tl2.to(self.displayDivs[2], 2, {left : "620px"});
        }

        function onSelection(e){               
            lnx.audio.stopAudio();
            var opt = e.currentTarget.getAttribute("data-optionNum");
            var isCorrect = self.correctAns.indexOf(opt) !== -1;
            var result = self.displayDivs[1];

            var tl = new TimelineMax();         
            tl.to(result, .75, {left : "0px"});

            result.classList.remove(isCorrect ? "incorrect" : "correct");
            result.classList.add(isCorrect ? "correct" : "incorrect");            
            e.stopPropagation();        
            e.preventDefault();
            return false;        
        }

    },

    hasContent : function(){        
        return false;
    },    
    
    destroy : function(){
        lnx.util.updateEventListener( this.options, "clcik", this.onSelection, true);
        this.options = [];
        this.correctAns = [];
        this.resultDiv = null; 
    }
}

lnx.progBar = {

    progBar: null,
    slider: null,

    init: function(){

        var isIpad = lnx.config.isIpad;
        var move = isIpad ? "touchmove" : "mousemove";
        var up = isIpad ? "touchend" : "mouseup";
        var down = isIpad ? "touchstart" : "mousedown";
        var slider = this.slider = document.getElementById("progBtn");
        var screenNum = this.screenNum = document.getElementById("screenNum");
        var scrNumD = screenNum.getBoundingClientRect().width /2;
        var progBar = this.progBar =  document.getElementById("progressBar");
        var numOfPages = this.numOfPages = lnx.nav.navNodes.length;
        var pcInc = this.pcInc = 100 / numOfPages;
        var remWidth = 53.125; //progress bar width
        this.screenInc = remWidth / numOfPages;
        var oldP = -1;
        slider.addEventListener(down, onSliderDown, false);

        function onSliderDown(e){
            document.addEventListener(move, onSliderMove, true);
            document.addEventListener(up, onSliderUp, true);
            //onSliderMove(e, true);//calcPage(e, null, true);
            screenNum.style.display = "block";
            e.stopPropagation();
            e.preventDefault();
            return false;
        }

        function onSliderMove(e, noNav){
            var rect = progBar.getBoundingClientRect();
            if((e.pageX < rect.left) || (e.pageX > (rect.right - 8))){
                //console.log('returning onslidermove');
                return;
            }
            var mPos = parseFloat(e.pageX) - parseFloat(rect.x);            
            var r = slider.getBoundingClientRect();
            calcPage(e, (r.left + (r.width/2)), noNav);       
            var val = "translateX(" + (mPos / 16 * lnx.config.getFontMultiplier()) + "rem)";
            slider.style.transform = val;    
            e && e.stopPropagation();
            e && e.preventDefault();
            return false;
        }      

        function onSliderUp(e){        
            //onSliderMove(e, false);           
            document.removeEventListener(move, onSliderMove, true);
            document.removeEventListener(up, onSliderUp, true);
            screenNum.style.display = "none"; 
            e.stopPropagation();
            e.preventDefault();
            return false;
        }

        function calcPage(e, discMid, noNav){ 
            var rect = progBar.getBoundingClientRect();            
            var d = e.pageX - rect.left;
            var orig = numOfPages * (d / rect.width);
            var p = Math.round(orig);      
            if(p < 0) p = 0;
            if(orig < 1) p = 0;
            if(p > (numOfPages - 1)) p = numOfPages - 1;   
            screenNum.innerHTML = (p + 1);
            if(p === oldP){
                noNav = true;
            } else {
                oldP = p;
            }
            if(noNav){
                return;
            }
            lnx.nav.goToScreen(p);
        }
    },    
    
    positionSlider: function(index){
        var val = "translateX(" + (index * this.screenInc) + "rem)";
        this.slider.style.transform = val;
        this.screenNum.style.transform = val;
    }
    
};

lnx.certification = {

    items : [],

    init: function(node, screenElm, frameElm){
        
        lnx.util.updateEventListener( document.getElementById("certifyBtn"), "click", this.onCertify);
        var e = screenElm.querySelectorAll("div");  
        this.items[0] = e[0];
        this.items[1] = e[1];
        this.items[2] = e[2];        
        this.items[3] =screenElm.getAttribute("data-audio");

        this.items[0].style.display = "block";
        this.items[1].style.display = "none";
        this.items[2].style.display = "none";
        if(lnx.scormApi.getTestCompletedSuccessfully()){
            this.items[1].style.display = "block";
            this.items[0].style.display = "none";
            if(this.items[3]){
            	lnx.audio.playAudio(this.items[3]);
			}
        }
        
    },

    onCertify: function(e){
        var self = lnx.certification;
        var r = lnx.scormApi.lmsCompleteCourse(true);
        if(r){
            self.items[0].style.display = "none";
            self.items[1].style.display = "none";
            self.items[2].style.display = "block";            
        }
    },

    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){  
        
        this.items = [];
    }

};

lnx.home = {

    items : [],
    isActive: false,
    overlayToc: null,
    firstAccess: true,
    timelines: null,
    timelinesV: null,
    origMsg3: null,

    init: function(node, screenElm, frameElm){
        
        var self = this;   
        //activate toc btn when user arives at this screen
        this.showTocModalIcon();
        let playBtns = screenElm.querySelectorAll("#" + lnx.nav.homeId + " div.topic .topicPlayBtn");
        lnx.util.updateEventListener(Array.prototype.slice.call(playBtns), "click", this.onGoToTopic);
        this.isActive = true;

        var tiles = screenElm.querySelectorAll(`div.tocTiles > div.tTile`);
        lnx.util.updateEventListener(Array.prototype.slice.call(tiles), "click", this.onTileClick);
        
        var activeTiles = this.showActiveTopics(screenElm);
        this.timelines = this.setUpAnims(this.getTotalTiles(screenElm));
        if(this.firstAccess){            
            this.showMessage(1);           
        } else {
            this.playAnims(activeTiles, this.timelines);
        }
    },

    showMessage: function(num, val, e){
        let self = lnx.home;
        if(!self.origMsg3){
            self.origMsg3 = document.querySelector(`div.tocMessages > p:nth-of-type(3)`).innerHTML;
        }
        let msg = document.querySelectorAll(`div.tocMessages > p`);
        let con = document.querySelector(`div.tocMessages`);
        for(var i=0;i<msg.length;i++){
            msg[i].style.display = "none";
        }
        con.style.top = "";
        con.style.left = "";        
        if(num){            
            msg = document.querySelector(`div.tocMessages > p:nth-of-type(${num})`);
            if(num === 3){        
                let rep1 = "";
                if(val.length > 1){
                    rep1 = "s";
                }
                msg.innerHTML = self.origMsg3.replace("{a}", rep1).replace("{b}", val);
                if(e){
                    let t = e.currentTarget;
                    con.style.top = (t.offsetTop + 60) + "px";
                    con.style.left = (t.offsetLeft + 40) + "px";
                }
            }            
            msg.style.display = "block";
        }
    },

    getTotalTiles: function(elm){
        if(!elm){
            elm = document;
        }
        var t = elm.querySelectorAll(`div.tocTiles > div.tTile`);
        return t.length;
    },

    showActiveTopics: function(elm){
        let status = lnx.nav.getTopicsStatus();
        let mods = elm.querySelectorAll(`div.tocTiles > div.tTile`);
        let activeTiles = [];
        for(var i=0;i<mods.length;i++){
            let m = mods[i];
            let mId = m.getAttribute("data-modnavid");
            if(mId && status[mId].available){
                activeTiles.push(i);
                let topics =  m.querySelectorAll("div.topic");
                for(var j=0;j<topics.length;j++){
                    let t = topics[j];
                    let tId = t.getAttribute("data-topicnavid");
                    let mt = status[mId].topics[tId];
                    t.style.display = "block";
                    let imgs = t.querySelectorAll("img");
                    if(mt.available){
                        imgs[1].style.display = "inline";
                        if(mt.complete){                            
                            imgs[0].src = "images/topicCheckMark.png";
                        }
                    } else {
                        imgs[1].style.display = "none";
                    }
                }
            }   
        }
        return activeTiles;
    },

    setUpAnims: function(totalTiles){
        
        var a = [];
        for(var i=0; i<totalTiles;i++){
            let num = i + 1;
            let tl = gsap.timeline({paused: true})
                .fromTo(`div.tocTiles > div.tTile:nth-of-type(${num}) > div.tFace:nth-of-type(1)`, {rotationY: 0}, {rotationY: -90, duration: 1})
                .fromTo(`div.tocTiles > div.tTile:nth-of-type(${num}) > div.tFace:nth-of-type(2)`, {rotationY: 90}, {rotationY: 0, duration: 1}, "<");
            a.push(tl);
        }
        return a;
    },

    onTileClick: function(e){
        let self = lnx.home;
        let status = lnx.nav.getTopicsStatus();
        let mId = e.currentTarget.getAttribute("data-modnavid");
        let m = status[mId];
        if(m.available){
            let i = 0;
            for(let k in status){
                if(status[k].id === mId){
                    break;
                }
                i++;
            }
            self.playAnims([i], self.isActive ? self.timelines : self.timelinesV, true);
            //clear msgs - pass null arg
            self.showMessage(null);
            if(self.firstAccess){
                setTimeout(self.showMessage, 1100, 2);
                self.firstAccess = false;
            }           
        } else {
            let num = parseInt(e.currentTarget.querySelector(".tileFrontText > p").innerText.charAt(0));
            let m = getIncompleteModNums(num)
            self.showMessage(3, m, e);
        }

        function getIncompleteModNums(num){
            let status = lnx.nav.getTopicsStatus();
            let a = orderMods(status);
            let b = [];
            for(let i=0;i<a.length;i++){
                if(status[a[i]].index < num && status[a[i]].complete != true){
                    b.push((i+1));
                }
            }
            if(b.length === 1){
                return `${b[0]}`;
            } else {
                return `${b[0]}-${b[b.length-1]}`;
            }
        }

        function orderMods(mods){
            let a = [];
            for(let m in mods){
               a.push(m);
            }
            a.sort(function(a,b){
                if(a.index < b.index){
                    return -1;
                } else {
                    return 1;
                }
            });
            return a;
        }
    },

    playAnims: function(tiles, anims, isClick, isVirtual){

       if(!isClick && isVirtual){
        let tl = gsap.timeline()
        .fromTo(`#overlayToc div.tocTiles`, {scale: .8, opacity: 0}, {scale: 1, opacity: 1, duration: .3})
       }

        for(var i=0; i<tiles.length;i++){
            let anim = anims[tiles[i]];
            if(isClick && (anim.progress() > 0)){
                anim.reverse();
            } else {
                anim.seek(0);
                anim.play();
            }
        }
    },

    createTocModal: function(){

        var toc = document.querySelector("#overlayToc");
        var con = toc.querySelector("div.overlayTocContainer");
        var ul = toc.querySelector("#overlayToc div.popUnderlay");
        con.innerHTML = lnx.nav.screensMap[lnx.nav.homeId].innerHTML;            
        this.overlayToc = {toc: toc, con: con, ul: ul, active: false};
        var close =  document.querySelector("#overlayToc img.overlayTocCloseBtn");
        lnx.util.updateEventListener(close, "click", this.showTocModal);
        lnx.util.updateEventListener(ul, "click", this.showTocModal);

        let playBtns = toc.querySelectorAll("div.topic .topicPlayBtn");
        lnx.util.updateEventListener(Array.prototype.slice.call(playBtns), "click", this.onGoToTopicFromModal);

        var tiles = toc.querySelectorAll(`div.tocTiles > div.tTile`);
        lnx.util.updateEventListener(Array.prototype.slice.call(tiles), "click", this.onTileClick);

        this.showActiveTopics(this.overlayToc.toc);
        this.timelinesV = this.setUpAnims(this.getTotalTiles());        
        if((!lnx.nav.isFarIndexBeforeHomeScreen()) || lnx.scormApi.getIsCourseComplete()){
            // bookmark is beyond home screen so allow user see and click it
            this.showTocModalIcon();
        }
    },

    showTocModalIcon: function(){
        var tocBtn = document.querySelector("#tocBtn");
        tocBtn.classList.add("tocBtnActive");
    },

    showTocModal: function(e){
        var self = lnx.home;  

        if(self.isActive){
            // don't show modal if already on actual home screen
            return;
        }
        
        if(lnx.nav.isFarIndexBeforeHomeScreen()){
            //special case - we jump to the actual home screen if user clicks icon for virtual home screen before 
            //they have completed screens prior to home screen - avoids conflict with closed/locked navigation
            lnx.nav.goToHomeScreen();
            return;
        }     

        self.overlayToc.toc.style.display = self.overlayToc.active ? "none" : "block";
        self.overlayToc.ul.style.display = self.overlayToc.active ? "none" : "block";
        self.overlayToc.active = self.overlayToc.active ? false : true; 
        if(self.overlayToc.active){           
            // let activeTilesV = this.showActiveTopics(this.overlayToc.toc);
            // self.playAnims(activeTilesV, self.timelinesV, false, true);
        }
    },

    onGoToTopicFromModal: function(e){
        var self = lnx.home;
        self.onGoToTopic(e);
        self.showTocModal();
    },


    onGoToTopic: function(e){
        var navId = e.currentTarget.parentNode.getAttribute("data-screennavid");
        lnx.nav.navigate(navId)
    },

    hasContent : function(){
        
        return false;
    },    
    
    destroy : function(){  
        
        this.timelines = [];
        this.isActive = false;
        this.firstAccess = false;
    }
};

lnx.flashCard = {
    items : [],
    stage: null,
    id: null,
    total: 0,

    init: function(node, screenElm, frameElm){
       
        var self = this;
        this.stage = 1;
        this.id = screenElm.getAttribute("id");
        var flashCards = this.items =  getFlashCards();
        this.total = flashCards.total;
        this.changeCard = changeCard;
        this.showCongrats = showCongrats;
        this.congratsTl;
        var hideMessage = true;
        var currentCardNum = 0;
        
        var btns =  gsap.utils.toArray("div.flashCardButtons > img");
        for(let i = 0; i < btns.length; i++){           
            btns[i].addEventListener("click", onForwardNavEvent);
        }

        //initCongratsScreen();

        var circles = initCircles(flashCards.total);
        setActiveCircle(0, 0);

        function onForwardNavEvent(e){
            var dir = e.target.getAttribute("data-fcNavDir");
            lnx.nav.navigate(dir);
        }

        function changeCard(dir){
            var r = flashCards;
            var cardItem;
            removeMessage();
            previousActiveCardNum = r.current;
            if(dir === "next"){
                if(!(r.current < (r.total - 1))){
                    return;
                }
                cardItem = r.deck[r.current];
                cardItem.tl.play();           
                r.current++;
                r.deck[r.current].card.style.display = "flex";               
            } else {
                if(!(r.current > 0)){
                    return;
                }        
                r.current--;            
                cardItem = r.deck[r.current];
                if(cardItem)
                    cardItem.tl.reverse();
            }
            setActiveCircle(previousActiveCardNum, r.current);
        }

        function showCongrats(isReverse){
           if(isReverse){
            self.congratsTl.reverse();
           } else {
            var msg = document.querySelector("div.congratsScreen > p");
            msg.focus();
            self.congratsTl.play();
            var file = document.querySelector("div.congratsScreen").getAttribute("data-audio");
           lnx.audio.playAudio(file, 400);
           }
        }

        function getFlashCards(){
            var fcs = gsap.utils.toArray("div.flashCard");
            var deck = [];
            fcs.forEach(function(card, i){
                var tl = gsap.timeline({paused: true})
                    .to(card, {rotation: -12, x: "-=43.75rem", opacity: 0, duration: 1, ease: "power3.in"});
                    card.style.zIndex = fcs.length - i;
                    deck.push({card: card, tl: tl});
            });
            return {deck: deck, current: 0, total: deck.length};
        }

        function initCongratsScreen(){
            var congrats = document.querySelectorAll("div.congratsScreen");
            var msg = document.querySelector("div.congratsScreen > p");
            msg.addEventListener("blur", (e) => {msg.style.display = "none";});
            //msg.focus();
            self.congratsTl = gsap.timeline({paused: true})
                    //.to(ins, {opacity: 0, duration: .3})
                    .set(congrats, {display: "flex"})                
                    .from(congrats, {x: "58.125rem", duration: 1, ease: "power2.in"}, "<-.2")
                    .from(msg, {opacity: 0, duration: .75}, "+=.3");
        }

        function removeMessage(){
            if(hideMessage){
                var msg = document.querySelector("div.flashCardInstruction");
                // msg.classList.remove("flashCardInstructionAnim");
                // msg.classList.add("fadeOutAnimClass");
                msg.style.display = "none";
                hideMessage = false;
            }
        }

        function initCircles(num){
            var container = document.querySelector("div.circleContainer");
            var s = "";
            for(var i=0;i< num; i++){
                s +=  "<div></div>";
            }
            container.innerHTML = s;
            return container.childNodes;
        }

        function setActiveCircle(old, current){
            circles[old].style.backgroundColor = "#C3C7D5";
            circles[current].style.backgroundColor = "#37424C";
        }
    },    

    updateVirtualScreen: function(dir, isFinal, fromFinal){
        isFinal = false;
        var self = this;
        if(isFinal){
            this.showCongrats();
        } else if(fromFinal){
            this.showCongrats(fromFinal);
        } else {
            this.changeCard(dir);
        }       
        lnx.cache.setValue("complete", this.id, true); 
    },

    insertVirtualScreen: function(dir){
        if(dir == "next"){
            if(this.stage < (this.total)){
                this.stage++;
                var isFinal = this.stage > this.total;
                this.updateVirtualScreen(dir, isFinal);
                return true;
            } else {
                return false;
            }
        } else {
            if(this.stage > 1){
                this.stage--;
                var fromFinal = this.stage === this.total;
                this.updateVirtualScreen(dir, false, fromFinal);
                return true;
            } else {
                return false;
            }            
        }
    },

    isFinalScreen: function(){
        if(this.stage > this.total){
            return true;
        } else {
            return false;
        }
    },

    hasContent : function(){
        if(this.initialized){
            return true;
        } else {
            return false;
        }
    },
    
    
    destroy : function(){  
        
        this.items = [];
    }
};

lnx.verticalParallax = {

    screenNum: null,
    totalScreenNum: 4,
    panels: [],
    timelines: null,
    complete: false,

    init : function( node, screenElm, frameElm ){
                
        var self = this;
        this.complete = false;
		this.screenNum = 0;
        this.audio = [];
        this.container = screenElm.querySelector(".vpLaxContainer");
        this.panels = Array.prototype.slice.call(document.querySelectorAll("div.vpLax"));        
        this.panels.forEach((v,i)=>{
            self.audio.push(v.getAttribute("data-audio"));
        });
        var n = screenElm.getAttribute("numScreens");
        if(!n){
            this.totalScreenNum = this.panels.length;
        } else {
            this.totalScreenNum = n;
        }
        var self = this;
        this.insertVirtualScreen("next");
	},
	
	hasContent : function(){		
		return false;
	},

    updateVirtualScreen: function(dir){  
        
        this.container.classList.remove("vpLaxScreen1","vpLaxScreen2","vpLaxScreen3","vpLaxScreen4","vpLaxScreen5");
        this.container.classList.add("vpLaxScreen" + this.screenNum);
        lnx.audio.playAudio(this.audio[this.screenNum - 1], this.screenNum === 1 ? 0 : 1000);
    },

    insertVirtualScreen: function(dir){
        if(typeof(dir) === "object"){
            dir = "next";
        }
        if(dir === "next"){
            if(this.screenNum < this.totalScreenNum){
                ++this.screenNum;
                this.updateVirtualScreen(dir);
                return true;
            } else {
                this.complete = true;
                return false;
            }
        } else if(this.screenNum <= 1){                
            return false;
        } else {
            --this.screenNum;
            this.updateVirtualScreen(dir);
            return true;
        }        
    },

    getStillHasScreens: function(){
        return !this.complete;
    },

    isFinalScreen: function(){
        return (this.screenNum >= this.totalScreenNum);
    },

	isComplete: function(){
		return true;
	},
	
	destroy : function( type ){
		this.panels = [];
        this.timelines = [];
	}	
};

lnx.infoGraphicVirtualScreens1 = {

    items : [],
    id: null,
    stage: null,
    audio: [],
    numScreens: null,
    nodeId: null,

    init: function(node, screenElm, frameElm, origNavId){

        var self = this;
        this.id = screenElm.getAttribute("id");
        this.resId = node.getAttribute("resId");        
        this.screen = 0;
        this.textBoxes = screenElm.querySelectorAll("div.hiddenBoxText > div");      
        this.numScreens = this.textBoxes.length;

        var reverseIn = origNavId === "prev"; // must be reversing into activity so show last virtual screen
        var dir = reverseIn ? "prev" : "next";     
        this.infoGraphic = this.insertInfoGraphic(screenElm, node, reverseIn);
        this.insertVirtualScreen(dir, reverseIn);
    },

    insertInfoGraphic: function(e, n, noAnim){
        var g = e.querySelector("div.infoGraphicContainer");
        if(!g.querySelector("div.outerTable")){
           var tbl = n.ownerDocument.documentElement.getElementsByTagName("template")[0].firstChild;
           g.innerHTML = tbl.outerHTML;
        }
        if(!noAnim){
            this.animateInfoGraphic(g);
        }        
        return g;
    },

    animateInfoGraphic: function(g){
        var tl = gsap.timeline();
        var headers = g.querySelectorAll("div.infoTableHeader > div");
        var colls = g.querySelectorAll("div.infoTableBody > div");
        tl.set(this.textBoxes[0], {opacity:0});
        tl.from(headers, {opacity: 0, stagger: .2, duration: .6, ease: "circ.in", delay: .1});
        tl.from(colls, {opacity: 0, stagger: 0.2, duration: .6, ease: "circ.in"}, "<");
        tl.to(this.textBoxes[0], {opacity: 1, duration: 1 ,ease: "ease.in"}, "-=1");
    },

    getResId: function(){
        return this.resId + "_" + this.screen;
    },

    playAudio: function(){
        lnx.audio.playAudio(this.getResId());
    },

    hasContent : function(){
        if(this.initialized){
            return true;
        } else {
            return false;
        }
    },

    updateVirtualScreen: function(dir){

        var pos = [-10000,-54,-42,-30,-18,-6];
        
        for(var i = 0; i < this.textBoxes.length; i++){
            this.textBoxes[i].classList.remove("showChartTextBox1");
        }
        this.textBoxes[this.screen-1].classList.add("showChartTextBox1");
        
        //position spotlight    
        //this.textBoxes[0].parentNode.style.backgroundPositionX = pos[this.screen - 1] + "rem";

        var headers = this.infoGraphic.querySelectorAll("div.infoTableHeader > div > aside");
        headers.forEach(function(h,i){h.classList.remove("infoTableHeaderTitleOn" +i)});
        var paras = this.infoGraphic.querySelectorAll("div.infoTableHeader > div > p:last-of-type");
        paras.forEach(function(h,i){h.classList.remove("infoTableHeaderTitleColorOn")});

        if(this.screen > 1){
            var i = this.screen - 2;
            headers[i].classList.add("infoTableHeaderTitleOn" + i);
            paras[i].classList.add("infoTableHeaderTitleColorOn");
            var tl = gsap.timeline(); 
            tl.set("img.sp1",{display:"block"});
            tl.set("img.sp1", {left: `${pos[this.screen-1]}rem`});
            tl.from("img.sp1",{opacity:0, duration: 2, delay: 1});
        }

        this.playAudio();
    },

    insertVirtualScreen: function(dir, showFinalReverse){        
        if(showFinalReverse){
            // screen will be decrimented to correct value below in "prev" conditional
            this.screen = this.numScreens + 1;            
        }
        
       if(dir === "next"){
            if(this.screen < this.numScreens){
                this.screen++;
                this.updateVirtualScreen(dir);
                return true;
            }else{
                return false;
            }
       }else if(dir === "prev"){
            if(this.screen <= 1){
                return false;
            }else{
                this.screen--;
                this.updateVirtualScreen(dir);
                return true;
            }       
        }else{
            return false;
        }
    },

    isComplete: function(){
        return lnx.cache.getValue("complete", this.id);    
    },

    isFinalScreen: function(){
        return (this.screen >= this.numScreens)
    },

    destroy : function(newType, navId){   
        if(navId === this.id){
            return;        
        }        
        this.screen = this.infoGraphic = null;
        this.resId = this.id = this.textBoxes = null;
    }

};

lnx.infoGraphicGen = {

    items : [],
    id: null,
    stage: null,
    audio: [],
    numScreens: null,
    nodeId: null,

    init: function(node, screenElm, frameElm, origNavId){

        var self = this;
        this.id = screenElm.getAttribute("id");  
        var type = parseInt(node.getAttribute("subType"));   
        var alts = [this.animateInfoGraphic1, this.animateInfoGraphic2, this.animateInfoGraphic3, this.animateInfoGraphic4];
        this.animateInfoGraphic = alts[type - 1];
        this.textBox = screenElm.querySelector("div.hiddenBoxText > div");  
        this.infoGraphic = this.insertInfoGraphic(screenElm, node);
        this.animateInfoGraphic(this.infoGraphic);
        this.showSpotLight(type-1);
    },

    insertInfoGraphic: function(e, n, noAnim){
        var g = e.querySelector("div.infoGraphicContainer");
        if(!g.querySelector("div.outerTable")){
           var tbl = n.ownerDocument.documentElement.getElementsByTagName("template")[0].firstChild;
           g.innerHTML = tbl.outerHTML;
        }
        this.textBox.parentNode.style.backgroundPositionX = "-54rem";
        this.textBox.style.display = "block";        
        return g;
    },

    showSpotLight: function(i){
        var pos = [-54,null,-54,0];
        var img = "img.sp1";
        if(pos[i] === null){
            return;
        }
        if(i === 3){
            img = "img.sp2";
        }
        var tl = gsap.timeline(); 
        tl.set(img,{display:"block"});
        tl.set(img, {left: `${pos[i]}rem`});
        tl.from(img,{opacity:0, duration: 1.5, delay: 1});
    },

    animateInfoGraphic1: function(g){        
        var items = g.querySelectorAll("div.infoTblColl:first-of-type > div");
        var tl = gsap.timeline();
        tl.to(items, {backgroundColor: "#ce5047", color: "#fff", stagger: .4, duration: .5, ease: "circ.out", delay: 1});
    },

    animateInfoGraphic2: function(g){
        //this.textBox.parentNode.style.backgroundPositionX = "-10000rem";
        this.animateArrows("div.infoTblColl > div svg > path.arrowMidSvgHd");
        this.animateArrowsDwn("div.infoTblColl > div svg > path.arrowDwnSvgHd");
    },

    animateInfoGraphic3: function(g){
        this.animateArrowsDwn("div.infoTblColl:first-of-type > div svg > path.arrowDwnSvgHd");        
    },

    animateInfoGraphic4: function(g){ 
        this.animateArrows("div.infoTblColl > div:first-of-type svg > path.arrowMidSvgHd");
    },

    animateArrows: function(sel){
        var tl = gsap.timeline();   
        var arwHds = document.querySelectorAll(sel);
        tl.to(arwHds, {
            keyframes: {                
                "20%": {x: "-=0rem", opacity: 0},
                "21%": {x: "-=1.7rem", opacity: 1},
                "50%": {scale: 2.5},
                "80%": {strokeWidth: "0.2rem"},
                "100%": {x: "=+0px", scale: 1, strokeWidth: "0.09rem"},
                easeEach: "none",
                ease: "power1.in"
            },
            delay: 1.5,
            duration: 1.2,
            transformOrigin: "50% 50%"
        });
    },

    animateArrowsDwn: function(sel){
        var tl = gsap.timeline();   
        var arwHds = document.querySelectorAll(sel);
        tl.to(arwHds, {
            keyframes: {                
                "20%": {y: "-=0rem", opacity: 0},
                "21%": {y: "-=1.7rem", opacity: 1},
                "50%": {scale: 2.5},
                "80%": {strokeWidth: "0.2rem"},
                "100%": {y: "=+0px", scale: 1, strokeWidth: "0.09rem"},
                easeEach: "none",
                ease: "power1.in"
            },
            delay: 1.5,
            duration: 1.2,
            transformOrigin: "50% 50%"
        });

    },

    playAudio: function(){
        lnx.audio.playAudio(this.getResId());
    },

    hasContent : function(){
        return false;
    },

    destroy : function(newType, navId){   
        if(navId === this.id){
            return;        
        }        
        this.screen = this.infoGraphic = null;
        this.resId = this.id = this.textBoxes = null;
    }
};

lnx.infoGraphicVirtualScreens2 = {

    items : [],
    id: null,
    stage: null,
    audio: [],
    numScreens: null,
    nodeId: null,

    init: function(node, screenElm, frameElm, origNavId){

        var self = this;
        this.id = screenElm.getAttribute("id");
        this.instanceTmpls = lnx.infographicCongig.getInstanceTemplates(parseInt(node.getAttribute("instance")));
        this.screen = 0;
        this.textBoxes = screenElm.querySelectorAll("div.hiddenBoxText > div");      
        this.numScreens = Object.keys(this.instanceTmpls).length;

        var reverseIn = origNavId === "prev"; // must be reversing into activity so show last virtual screen
        var dir = reverseIn ? "prev" : "next";     
        this.infoGraphic = this.insertInfoGraphic(screenElm, node, reverseIn);
        this.infoOuterTable = screenElm.querySelector("div.infoOuterTable"); 
        this.insertVirtualScreen(dir, reverseIn);
    },

    insertInfoGraphic: function(e, n, noAnim){
        var g = e.querySelector("div.infoGraphicContainer");
        if(!g.querySelector("div.outerTable")){
           var tbl = n.ownerDocument.documentElement.getElementsByTagName("template")[0].firstChild;
           g.innerHTML = tbl.outerHTML;
        } 
        return g;
    },

    showTemplate1: function(p){
        this.highLightItem(-1,-1);
        // if(dir === "prev"){
        //     this.scaleUpTable(p, true);
        // }        
        this.resetMain();
        this.textBoxes.forEach(function(v){v.classList.remove("showChartTextBox1", "leftHandSideBoxText")});
        this.textBoxes[this.screen-1].style.left = p.txtLoc;
        this.textBoxes[this.screen-1].classList.add("showChartTextBox1");
        var headers = this.infoGraphic.querySelectorAll("div.infoTableHeader > div > aside");
        headers.forEach(function(h,i){h.classList.remove("infoTableHeaderTitleOn" +i)});
        var paras = this.infoGraphic.querySelectorAll("div.infoTableHeader > div > p:last-of-type");
        paras.forEach(function(h,i){h.classList.remove("infoTableHeaderTitleColorOn")});
        headers[p.titleIdx].classList.add("infoTableHeaderTitleOn" + p.titleIdx);
        paras[p.titleIdx].classList.add("infoTableHeaderTitleColorOn");
        this.showSpotLight(1, p.spotLoc);
    },

    showTemplate2: function(p){
        this.clearSpotLight();
        this.showCheckmarks(-1);
        this.resetItems();
        this.textBoxes.forEach(function(v){v.classList.remove("showChartTextBox1","leftHandSideBoxText")});
        var tb = this.textBoxes[this.screen-1];
        tb.classList.add("leftHandSideBoxText");
        var header = this.infoGraphic.querySelector("div.infoTableHeader");
        var body = this.infoGraphic.querySelector("div.infoTableBody");
        var item =  this.infoGraphic.querySelector(`div.infoTblColl:nth-of-type(${p.colIdx+1}) > div:nth-of-type(${p.itemIdx+1})`);
        var bgColor = window.getComputedStyle(item).borderColor;

        var tl = gsap.timeline();
        tl.set(tb.querySelectorAll("p"), {opacity: 0});

        //tl.set(this.infoOuterTable,{scale:1});
        //tl.from(tb, {x: "60%", duration: .6, ease: "power1.out"});     
        
        //only scale if unscaled
        if(this.infoOuterTable.style.transform === "none"){           
            tl.from(tb, {x: "60%", duration: .6, ease: "power1.out"});
            //required to clear cached value
            gsap.set(this.infoOuterTable, {clearProps: "scale"});
            tl.to(this.infoOuterTable, {scale: 1.7, duration: 1, x: `${p.shiftH}`, transformOrigin: "0% 0%"}, 0);
            tl.to(body,{duration: 1, y: `${p.shiftV}`, transformOrigin: "0% 0%"}, 0);
        }        

        tl.to(tb.querySelectorAll("p"), {opacity: 1, duration: .6});
        tl.to(item, {backgroundColor: bgColor, color: "#fff", duration: .4},0);

        // this.scaleUpTable(p);
        // this.highLightItem(p.colIdx + 1, p.itemIdx);
    },

    showTemplate3: function(p){
        this.scaleDown();
        this.highLightItem(-1,-1);
        this.textBoxes.forEach(function(v){v.classList.remove("showChartTextBox1", "leftHandSideBoxText")});
        this.textBoxes[this.screen-1].classList.add("showChartTextBox1");
        this.textBoxes[this.screen-1].style.left = p.txtLoc;
        this.showCheckmarks(p.colIdx+1);
        this.showSpotLight(3, p.spotLoc);
    },

    showTemplate4: function(p, cl = "arrowMidSvgHd"){
        this.resetMain();
        this.highLightItem(-1,-1);
        //this.showCheckmarks(-1);
        this.textBoxes.forEach(function(v){v.classList.remove("showChartTextBox1", "leftHandSideBoxText")});
        this.textBoxes[this.screen-1].classList.add("showChartTextBox1");
        this.textBoxes[this.screen-1].style.left = p.txtLoc;
        
        var tl = gsap.timeline();   
        var sel = `div.infoTblColl:nth-of-type(${p.colIdx}) svg > path.${cl}`;
        var arwHds = this.infoGraphic.querySelectorAll(sel);
        tl.to(arwHds, {
            keyframes: {                
                "20%": {x: "-=0rem", opacity: 0},
                "21%": {x: "-=1.7rem", opacity: 1},
                "50%": {scale: 2.5},
                "80%": {strokeWidth: "0.2rem"},
                "100%": {x: "=+0px", scale: 1, strokeWidth: "0.09rem", onComplete: doHighlight},
                easeEach: "none",
                ease: "power1.in"
            },
            delay: 1.5,
            duration: 1.2,
            transformOrigin: "50% 50%"
        });

        var idxs = p.items;
        var self = this;
        function doHighlight(){
            idxs.forEach(function(i){
                self.highLightItem(p.colIdx+1, i, true);
            });
        }    
        this.showSpotLight(1, p.spotLoc);
    },

    showTemplate5: function(p){
        this.scaleDown();
        // p.colIdx = 5;
        // this.showTemplate4(p, "arrowUpLSvgHd");
        this.resetMain();
        this.highLightItem(-1,-1);
        //this.showCheckmarks(-1);
        this.textBoxes.forEach(function(v){v.classList.remove("showChartTextBox1", "leftHandSideBoxText")});
        this.textBoxes[this.screen-1].classList.add("showChartTextBox1");
        this.textBoxes[this.screen-1].style.left = p.txtLoc;
        
        var tl = gsap.timeline();   

        var sel = `div.infoTblColl:nth-of-type(5) svg > path.arrowUpSvgHd`;
        var arwHds = this.infoGraphic.querySelectorAll(sel);
        tl.to(arwHds, {
            keyframes: {                
                "20%": {y: "-=0rem", opacity: 0},
                "21%": {y: "+=1.7rem", opacity: 1},
                "50%": {scale: 2.5},
                "80%": {strokeWidth: "0.2rem"},
                "100%": {y: "=+0px", scale: 1, strokeWidth: "0.09rem", onComplete: doHighlight},
                easeEach: "none",
                ease: "power1.in"
            },
            delay: 1.5,
            duration: 1.2,
            transformOrigin: "50% 50%"
        });

        sel = `div.infoTblColl:nth-of-type(5) svg > path.arrowUpLSvgHd`;
        arwHds = this.infoGraphic.querySelectorAll(sel);
        tl.to(arwHds, {
            keyframes: {                
                "20%": {y: "-=0rem", opacity: 0},
                "21%": {y: "+=2rem", opacity: 1},
                "50%": {scale: 2.5},
                "80%": {strokeWidth: "0.2rem"},
                "100%": {y: "=+0px", scale: 1, strokeWidth: "0.09rem", onComplete: doHighlight},
                easeEach: "none",
                ease: "power1.in"
            },
            delay: 0,
            duration: 1.2,
            transformOrigin: "50% 50%"
        });
        

        var idxs = p.items;
        var self = this;
        function doHighlight(){
            var i = idxs.shift();
            if(i !== undefined){
                self.highLightItem(p.colIdx+1, i, true, true);
            }            
        }    
        this.showSpotLight(1, p.spotLoc);
    },

    showSpotLight: function(i, loc){
        this.clearSpotLight();
        var img = `img.sp${i}`;        
        var tl = gsap.timeline(); 
        tl.set(img,{display:"block"});
        tl.set(img, {left: loc});
        tl.from(img,{opacity:0, duration: 1.5, delay: 1});
    },

    clearSpotLight: function(){
        document.querySelector("img.sp1").style.display = "none";
        document.querySelector("img.sp3").style.display = "none";
    },

    scaleDown: function(){
        var self = this;
        var tl = gsap.timeline();
        tl.to(this.infoOuterTable, {scale: 1, duration: 1, x: 0, transformOrigin: "0% 0%"});
        tl.to("div.infoTableBody",{duration: 1, y: 0, transformOrigin: "0% 0%", onComplete: () => {self.resetMain()}}, 0);
    },

    resetMain: function(){ 
        this.infoOuterTable.style.transform = "none";
        this.infoGraphic.querySelector("div.infoTableBody").style.transform = "none";
    },

    resetItems: function(){
        var tl = gsap.timeline();
        tl.set("div.infoTblColl > div", {backgroundColor: "#fff", color: "#38424C"});
    },

    highLightItem: function(col, item, noDelay, noReset){
        var sel = `div.infoTblColl:nth-of-type(${col}) > div`;
        if(col < 0){
            sel = "div.infoTblColl > div";
        }
        var delay = 1;
        if(noDelay){
            delay = 0;
        }
        var items = this.infoGraphic.querySelectorAll(sel);
        var tl = gsap.timeline();
        if(!noReset){
            tl.set(items, {backgroundColor: "#fff"});
            tl.set(items, {color: "#38424C"});
        }
        
        var bgColor = window.getComputedStyle(items[0]).borderColor;
        if(col >= 0 && item >= 0){
            tl.to(items[item], {backgroundColor: bgColor, color: "#fff", duration: 1, ease: "circ.out", delay: delay});
        }        
    },

    showCheckmarks: function(col){
        var cm = this.infoGraphic.querySelectorAll("div.infoTableBody img.checkmark");
        cm.forEach(function(v){v.style.display = "none"});
        if(col >= 0){
            var sel = `div.infoTblColl:nth-of-type(${col}) img.checkmark`;
            cm = this.infoGraphic.querySelectorAll(sel);
            var tl = gsap.timeline();
            tl.to(sel, {display: "block", stagger: .25, duration: .3, ease: "circ.out", delay: 2});
        }
    },

    animateInfoGraphic: function(g){
        var tl = gsap.timeline();
        var headers = g.querySelectorAll("div.infoTableHeader > div");
        var colls = g.querySelectorAll("div.infoTableBody > div");
        tl.set(this.textBoxes[0], {opacity:0});
        tl.from(headers, {opacity: 0, stagger: .2, duration: .6, ease: "circ.in", delay: .1});
        tl.from(colls, {opacity: 0, stagger: 0.2, duration: .6, ease: "circ.in"}, "<");
        tl.to(this.textBoxes[0], {opacity: 1, duration: 1 ,ease: "ease.in"}, "-=1");
    },

    getResId: function(){
        return this.resId + "_" + this.screen;
    },

    playAudio: function(){
        lnx.audio.playAudio(this.getResId());
    },

    hasContent : function(){
        if(this.initialized){
            return true;
        } else {
            return false;
        }
    },

    updateVirtualScreen: function(dir){

        var t = this.instanceTmpls[this.screen-1];
        var m = Object.keys(t)[0];
        this["show" + m](t[m]);
        this.playAudio();
    },

    insertVirtualScreen: function(dir, showFinalReverse){        
        if(showFinalReverse){
            // screen will be decrimented to correct value below in "prev" conditional
            this.screen = this.numScreens + 1;            
        }
        
       if(dir === "next"){
            if(this.screen < this.numScreens){
                this.screen++;
                this.updateVirtualScreen(dir);
                return true;
            }else{
                return false;
            }
       }else if(dir === "prev"){
            if(this.screen <= 1){
                return false;
            }else{
                this.screen--;
                this.updateVirtualScreen(dir);
                return true;
            }       
        }else{
            return false;
        }
    },

    isComplete: function(){
        return lnx.cache.getValue("complete", this.id);    
    },

    isFinalScreen: function(){
        return (this.screen >= this.numScreens)
    },

    destroy : function(newType, navId){   
        if(navId === this.id){
            return;        
        }        
        this.screen = this.infoGraphic = null;
        this.resId = this.id = this.textBoxes = this.infoGraphic = this.infoOuterTable = this.instanceTmpls = null;
    }

};

lnx.infographicCongig = {

    getInstanceTemplates: function(inst){
        return this.instances[inst];
    },

    instances: [
        [
            {Template1:{spotLoc: "-54rem", txtLoc: "23.5%", titleIdx: 0}},
            {Template2:{colIdx: 0, itemIdx: 0, shiftH: "0rem", shiftV: "0rem", isInit: true}},
            {Template2:{colIdx: 0, itemIdx: 1, shiftH: "0rem", shiftV: "0rem", }},
            {Template2:{colIdx: 0, itemIdx: 2, shiftH: "0rem", shiftV: "0rem", }},
            {Template2:{colIdx: 0, itemIdx: 3, shiftH: "0rem", shiftV: "0rem", }},
            {Template3:{colIdx: 0, spotLoc: "-54rem", txtLoc: "42.5%"}}

        ],
        [
            {Template1:{spotLoc: "-42rem", txtLoc: "42.5%", titleIdx: 1}},
            {Template4:{colIdx: 1, spotLoc: "-42rem", txtLoc: "42.5%", titleIdx: 1, items: [0,1,2,3]}},
            {Template2:{colIdx: 1, itemIdx: 4, shiftH: "-17.4rem", shiftV: "-17rem", isInit: true}},
            {Template3:{colIdx: 1, spotLoc: "-42rem", txtLoc: "63.5%"}}

        ],
        [
            {Template1:{spotLoc: "-30rem", txtLoc: "62.5%", titleIdx: 2}},
            {Template4:{colIdx: 2, spotLoc: "-30rem", txtLoc: "62.5%", titleIdx: 2, items: [0,1,2,3,6]}},
            {Template2:{colIdx: 2, itemIdx: 4, shiftH: "-37.4rem", shiftV: "-9rem", isInit: true}},
            {Template2:{colIdx: 2, itemIdx: 5, shiftH: "-37.4rem", shiftV: "-9rem"}},
            {Template3:{colIdx: 2, spotLoc: "-30rem", txtLoc: "3.5%"}}
        ],
        [
            {Template1:{spotLoc: "-18rem", txtLoc: "20.5%", titleIdx: 3}},
            {Template4:{colIdx: 3, spotLoc: "-18rem", txtLoc: "16.5%", titleIdx: 1, items: [0,1,2,3,4,5,7]}},
            {Template2:{colIdx: 3, itemIdx: 6, shiftH: "-57.2rem", shiftV: "-12.6rem", isInit: true}},
            {Template2:{colIdx: 3, itemIdx: 8, shiftH: "-57.2rem", shiftV: "-12.6rem"}},
            {Template3:{colIdx: 3, spotLoc: "-18rem", txtLoc: "20.5%"}}
        ],
        [
            {Template1:{spotLoc: "-6rem", txtLoc: "36%", titleIdx: 4}},
            {Template2:{colIdx: 4, itemIdx: 3, shiftH: "-77rem", shiftV: "-3.6rem", isInit: true}},
            {Template5:{colIdx: 4, spotLoc: "-6rem", txtLoc: "36%", titleIdx: 1, items: [2,1]}}
        ]
    ],
    
};

lnx.flowChartAnimation = {
    curShapeData: null,
    curShapes: null,
    shapeData: [[[1],[2],["ignore"],[3],[5],[4,6],[7]],[[1],["arrows"],[3],[8]],[[1],[2],[3,4]]],
    screen: 0,
    numScreens: null,
    prevText: null,
    curInst: 0,

    init : function( node, screenElm, frameElm, origNavId){
        var self = this;
        this.resId = node.getAttribute("resId");
        this.curShapes = [];
        this.shapes = screenElm.querySelectorAll("div.fcAnimContainer > div");
        this.text = screenElm.querySelectorAll("div.fcAnimTextContainer > div");
		this.numScreens = parseInt(screenElm.getAttribute("data-numscreens"));
        this.shapeData.forEach(function(v){
            if(v.length === self.numScreens){
                self.curShapeData = v;
            }
        });
        
        var reverseIn = origNavId === "prev"; // must be reversing into activity so show last virtual screen
        var dir = reverseIn ? "prev" : "next"; 
        setTimeout(function(){self.insertVirtualScreen(dir, reverseIn);},1)
    },

    updateVirtualScreen: function(dir, cleanUp){

        if(this.curShapes.length){
            var svgs = [];
            var txts = [];
            var cl = "#38424D";
            this.curShapes.forEach(
                function(v, i){
                    v.classList.toggle("clsResizeFcShape");
                    svgs.push(v.querySelector("svg"));
                    txts.push(v.querySelector("svg > text"));
                    v.querySelector("svg > text").style.fill = cl;
            });

            var tl = gsap.timeline();   
            //tl.to(txts, {fill: cl, duration: .2},0);
            tl.to(svgs, {fill: "#f9fbfc", duration: .2}, 0);           

            this.curShapes = [];
        }

        if(cleanUp) return;

        var self = this;
        var duration = .7;
        var delay = .3;
        var a = this.curShapeData[this.screen-1];
        a.forEach(function(v){
            if(v === "arrows"){
                runScaleArrows();
                return;
            } 
            if(v === "ignore"){
                // show shape 2 with 0 duration animation
                v = 2;
                duration = .1;
                delay = .1;
            }
            var sp = self.shapes[v-1];
            self.curShapes.push(sp);
            sp.classList.toggle("clsResizeFcShape");

            var svg = sp.querySelector("svg");
            var txt = sp.querySelector("svg > text");
            var clr = window.getComputedStyle(svg).stroke;
            var tl = gsap.timeline();

            tl.to(svg,{fill: clr, duration: duration, delay: delay, ease: "power1.in"});
            tl.to(txt,{fill: "#fff", duration: duration, delay: delay, ease: "power1.out", onComplete: onCompleteTween}, "<");

            function onCompleteTween(a){
                if(!self || !self.curShapes){
                    return;
                }
                
                var txt = this.targets()[0];
                var shape = txt.parentNode.parentNode;
                var revert = true;

                for(var i=0;i<self.curShapes.length;i++){
                    if(shape === self.curShapes[i]){
                        revert = false;
                        break;
                    }
                }
                if(revert){
                    txt.style.fill = "#38424D";
                    txt.parentNode.style.fill = "#f9fbfc";
                }
            }
        });

        var tl = gsap.timeline();
        if(this.prevText){
            tl.to(this.prevText,{opacity: 0, duration: .2});
            tl.set(this.prevText,{display: "none"});
        };        
        var cur = this.text[this.screen-1];
        if(cur === undefined) return;

        tl.set(cur, {display: "block", opacity: 0});
        tl.to(cur,{opacity: 1, duration: 1.2, ease: "power2.in"});
        this.prevText = cur;
        this.playAudio();

        function runScaleArrows(){
            var tl = gsap.timeline();
            tl.to(".hArrow1,.hArrow2", {
                keyframes: {   
                    "50%": {scale: 3.5},
                    "100%": {scale: 1},
                    easeEach: "none",
                    ease: "power1.in"
                },
                delay: .5,
                duration: 1.2,
                transformOrigin: "50% 50%"
            });
            tl.to("div.fcAnimContainer > div > svg", {
                keyframes: {   
                    "20%": {opacity: .3},
                    "60%": {opacity: .3},
                    "100%": {opacity: 1},
                    easeEach: "none",
                    ease: "power1.in"
                },
                delay: .5,
                duration: 1.6,
                transformOrigin: "50% 50%"
            }, 0);
        }
    },

    insertVirtualScreen: function(dir, showFinalReverse){        
        if(showFinalReverse){
            // screen will be decrimented to correct value below in "prev" conditional
            this.screen = this.numScreens + 1;            
        }
        
       if(dir === "next"){
            if(this.screen < this.numScreens){
                this.screen++;
                this.updateVirtualScreen(dir);
                return true;
            }else{
                return false;
            }
       }else if(dir === "prev"){
            if(this.screen <= 1){
                this.updateVirtualScreen(dir, true);
                return false;
            }else{
                this.screen--;
                this.updateVirtualScreen(dir);
                return true;
            }       
        }else{
            return false;
        }
    },

    getResId: function(){
        return this.resId + "_" + this.screen;
    },

    playAudio: function(){
        lnx.audio.playAudio(this.getResId());
    },
	
	hasContent: function(){		
		return false;
	},

	isComplete: function(){
		return true;
	},
	
	destroy : function( type ){
		this.current = this.items = this.curShapes = this.prevText = null;
        this.screen = 0;
	}	
};

lnx.drawFCchart = {
	
	init : function( node, screenElm, frameElm ){
		gsap.registerPlugin(DrawSVGPlugin);
        gsap.from(".cls-11", {duration:1, drawSVG: 0, delay:.5, stagger: .05});
        gsap.from(".cls-24", {opacity: 0, duration:1, delay: .5, stagger: .1},"<");
	},
	
	hasContent : function(){		
		return false;
	},

	isComplete: function(){
		return true;
	},
	
	destroy : function( type ){
		
	}	
	
};

lnx.blurBoxQuestion = {
    screen: 0,
    numScreens: 2,

    init : function( node, screenElm, frameElm, origNavId){
		var self = this;
        this.id = screenElm.getAttribute("id");    
        this.resId = node.getAttribute("resId");
        this.numScreens =  node.getAttribute("subType") === "2" ? 1 : 2;
        this.screen = 0;
        //this.textBoxes = Array.from(screenElm.querySelectorAll(".animTextDisplayBox"));
        this.paras = Array.from(screenElm.querySelectorAll(".blurBox > div"));
        this.proxy = screenElm.querySelector(".proxyImage");
        this.isRhs = this.proxy.classList.contains("proxyImageRight");
        var reverseIn = origNavId === "prev" && this.numScreens === 2; // must be reversing into activity so show last virtual screen
        var dir = reverseIn ? "prev" : "next";
        setTimeout(()=> self.insertVirtualScreen(dir, reverseIn));     
	},

    insertVirtualScreen: function(dir, showFinalReverse){        
        if(showFinalReverse){
            // screen will be decrimented to correct value below in "prev" conditional
            this.screen = this.numScreens + 1;            
        }
        
       if(dir === "next"){
            if(this.screen < this.numScreens){
                this.screen++;
                this.updateVirtualScreen(dir);
                return true;
            }else{
                return false;
            }
       }else if(dir === "prev"){
            if(this.screen <= 1){
                return false;
            }else{
                this.screen--;
                this.updateVirtualScreen(dir);
                return true;
            }       
        }else{
            return false;
        }
    },

    updateVirtualScreen: function(dir){
       
        var right = this.isRhs ? "Right" : "";
        if(dir === "next"){
            if(this.screen === 1){
                this.proxy.classList.add("animProxy" + right);
                this.paras[0].classList.add("showBlurQtext1")
            } else {
                this.paras[1].classList.add("showBlurQtext2")
            }
        } else {
            if(this.screen === 2){
                this.proxy.classList.add("setProxyImageEnd" + right);
                this.paras[0].classList.add("showBlurQtext1End");
                this.paras[1].classList.add("showBlurQtext2End");
            } else if(this.screen === 1){
                this.paras[1].classList.remove("showBlurQtext2");
                this.paras[1].classList.remove("showBlurQtext2End");
            }
        }
        
        this.playAudio();
    },

    getResId: function(){
        return this.resId + "_" + this.screen;
    },

    playAudio: function(){
        var delay = this.screen === 1 ? 1500 : 0;
        lnx.audio.playAudio(this.getResId(), delay);
    },
	
	hasContent : function(){		
		return false;
	},

	isComplete: function(){
		return true;
	},
	
	destroy : function( type ){
		
	}	
};

lnx.emailAnim1 = {

    screen: 0,
    numScreens: null,

    init : function( node, screenElm, frameElm, origNavId){
		var self = this;
        this.numScreens = parseInt(screenElm.getAttribute("data-numscreens"));
        this.id = screenElm.getAttribute("id");    
        this.resId = node.getAttribute("resId");
        this.screen = 0;
        this.bgImg = screenElm.querySelector("img");
        this.textBoxes = Array.from(screenElm.querySelectorAll(".animTextDisplayBox > div"));
        this.email = screenElm.querySelector(".scrollingEmail1");
        this.emailConLargeOuter = screenElm.querySelector(".emailContainerLargeOuter");
        this.emailConLargeMiddle = screenElm.querySelector(".emailContainerLargeMiddle");
        this.emailImg = screenElm.querySelector(".emailContainerLargeMiddle > img");
        var reverseIn = origNavId === "prev"; // must be reversing into activity so show last virtual screen
        var dir = reverseIn ? "prev" : "next";
        setTimeout(()=> self.insertVirtualScreen(dir, reverseIn));     
	},

    insertVirtualScreen: function(dir, showFinalReverse){        
        if(showFinalReverse){
            // screen will be decrimented to correct value below in "prev" conditional
            this.screen = this.numScreens + 1;            
        }
        
       if(dir === "next"){
            if(this.screen < this.numScreens){
                this.screen++;
                this.updateVirtualScreen(dir);
                return true;
            }else{
                return false;
            }
       }else if(dir === "prev"){
            if(this.screen <= 1){
                return false;
            }else{
                this.screen--;
                this.updateVirtualScreen(dir, showFinalReverse);
                return true;
            }       
        }else{
            return false;
        }
    },

    updateVirtualScreen: function(dir, showFinalReverse){

        var self = this;        
        
        if(showFinalReverse){
            this.emailConLargeOuter.classList.add("emailContainerLargeOuterShow");
            this.bgImg.classList.add("filterGrey");
        }

        if(this.screen === 1){
            this.email.classList.remove("doEmailScroll");
            addRemoveText();
        } else if(this.screen === 2){
            this.email.classList.add("doEmailScroll");
            this.emailConLargeOuter.classList.remove("emailContainerLargeOuterShow");
            this.bgImg.classList.remove("filterGrey");
            addRemoveText();
        } else {
            if(this.screen === 3){
                this.emailConLargeOuter.classList.add("emailContainerLargeOuterShow");
                this.bgImg.classList.add("filterGrey");
            }          
            addRemoveEmail();
            addRemoveText();
        }

        function addRemoveEmail(){
            var rm = dir === "next" ? self.screen - 1: self.screen + 1;
            var ad = self.screen;
            self.emailConLargeMiddle.classList.remove("emailContainerLargeMiddleScroll" + rm);
            self.emailImg.classList.remove("emailClip" + rm);          
            self.emailConLargeMiddle.classList.add("emailContainerLargeMiddleScroll" + ad);
            self.emailImg.classList.add("emailClip" + ad);
        }
        function addRemoveText(){
            var rm = dir === "next" ? self.screen-2: self.screen;
            var ad = self.screen-1;
            self.textBoxes[rm]?.classList.remove("showDisplayBox"+rm);  
            self.textBoxes[ad].classList.add("showDisplayBox"+ad); 
        }
           
        this.playAudio();
    },


    getResId: function(){
        return this.resId + "_" + this.screen;
    },

    playAudio: function(){
        lnx.audio.playAudio(this.getResId());
    },
	
	hasContent : function(){		
		return false;
	},

	isComplete: function(){
		return true;
	},
	
	destroy : function( type ){
		this.textBoxes = this.email =  this.emailConLargeOuter = this.emailConLargeMiddle = this.emailImg = null;
	}	
};

lnx.toc = {
	
    isActive: false,
    initialized: false,

	init : function( node, screenElm, frameElm ){
        var idx = lnx.nav.getTocIndexOfType("toc", node);
        this.updateToc(false, idx);
	},

    getNavIds: function(){
        return lnx.nav.getModuleNavIds();
    },

    updateToc: function(isModal, i){
        var self = this;
        isModal = isModal === true;
        var nIds = this.getNavIds();
        var d = lnx.nav.getCurrentProgressData();
        var t = Array.from(document.querySelectorAll(".pcDisplay"));
        t.forEach((v,i)=>{v.innerText = parseInt(d.overallPc) + "%";});
        t = Array.from(document.querySelectorAll(".greenProgLine"));
        t.forEach((v,i)=>{v.style.width = getWidth(i) + "rem";});
        t = Array.from(document.querySelectorAll(".circleTop"));
        t.forEach((v,i)=>{v.style.strokeDashoffset = (getDash() + "");});
        t = Array.from(document.querySelectorAll(".topicBar"));
        t.forEach((v,i)=>{addListener(v,i);});
        var w1 = parseFloat(window.getComputedStyle(t[0]).width) - (100 * (1/lnx.config.getFontMultiplier()));
        t.forEach((v,i)=>{addTopicTitleEllipsis(v, w1);});

        if(!isModal){
            addAnimations(i);
        }
       

        function getWidth(i){
            i = clampI(i, d.topicPc.length);
            var magic = 29.3;
            var p = d.topicPc[i];
            var r = magic / 100 * p;
            return r;
        }

        function getDash(){
            var magic = 592;
            var p = d.overallPc;
            var r = magic - (magic / 100 * p);
            return r;
        }

        function addListener(v,i){
            i = clampI(i, d.topicPc.length);
            var p = d.topicPc[i];
            if(!isNaN(p) && (p > 0 || prevComplete(i))){
                v.addEventListener("click", self.onGoToTopic.bind(self));
                v.setAttribute("data-navId", nIds[i])
                v.style.cursor = "pointer";
                if(p > 99){
                    v.querySelector(".toc2ImgCon").style.backgroundImage = "url(images/greenComplete.svg)";
                    v.setAttribute("data-topicComplete","true");
                    self.currentTopicIndex = i;
                } else {
                    v.querySelector(".toc2ImgCon").style.backgroundImage = `url(images/lockOpenClosed.svg?v=${Math.random()})`;
                }
            }

            function prevComplete(i){
                if(i){
                    var p2 = d.topicPc[i-1];
                    if(p2 > 99){
                        return true;
                    }
                }
                return false;
            }
        }

        function clampI(i, len){
            if(i >= len){
                i -= len;
            }
            return i;
        }

        function addAnimations(i){
            var lhs = document.querySelector(".toc2Lhs");
            lhs.classList.add("moveTocLhsUp");
            var msg = document.querySelector(".tocUiMsg");
            msg.classList.add("showTocUiMsg1");
            msg.style.transform = `translateY(${i*3.4}rem)`;
            var bar = document.querySelectorAll(".topicBar");
            bar[self.currentTopicIndex].classList.add("scaleTopicBar");
            var icon = bar[self.currentTopicIndex].querySelector(".toc2ImgCon");
            icon.classList.add("scaleTocIcon");
            icon.style.backgroundImage = "url(images/lockOpen.svg)";
        }

        function addTopicTitleEllipsis(t, w1){
            var p = t.querySelector("p:nth-of-type(2");
            var w2 = parseFloat(window.getComputedStyle(p).width);
            var a = p.innerHTML.split(" ");
            var elipsed = false;
            if(w2 > w1){
                p.title = p.innerText;
                elipsed = true;
            }
            while(w2 > w1){
                a.splice(a.length - 1,1);
                p.innerHTML = a.join(" ");
                w2 = parseFloat(window.getComputedStyle(p).width);
                if(a.length < 2){
                    break;
                }
            }
            if(elipsed){
                p.innerHTML = p.innerHTML + "...";
            }
        }
    },
	
	hasContent : function(){		
		return false;
	},

	isComplete: function(){
		return true;
	},

    createTocModal: function(){
               
        var closeBtn = `<img src="images/tocClose.svg" class="overlayTocCloseBtn">`;
        var toc = document.querySelector("#overlayToc");
        var con = toc.querySelector("div.overlayTocContainer");
        var ul = toc.querySelector("#overlayToc div.popUnderlay");
        con.innerHTML = closeBtn + lnx.nav.screensMap[lnx.nav.homeId].innerHTML;            
        this.overlayToc = {toc: toc, con: con, ul: ul, active: false};
        var close =  document.querySelector("#overlayToc img.overlayTocCloseBtn");
        lnx.util.updateEventListener(close, "click", this.showTocModal);
        lnx.util.updateEventListener(ul, "click", this.showTocModal);  
    },


    showTocModal: function(e, close){
        var self = lnx.toc;  
        
        if(close){
            self.overlayToc.active = true;
        }
        
        self.overlayToc.toc.style.display = self.overlayToc.active ? "none" : "block";
        self.overlayToc.ul.style.display = self.overlayToc.active ? "none" : "block";
        self.overlayToc.active = self.overlayToc.active ? false : true; 
        if(self.overlayToc.active){ 
            self.updateToc(true);
        }
    },

    onGoToTopic: function(e){
        var close = true;
        this.showTocModal(e, close);
        var navId = e.currentTarget.getAttribute("data-navId");
        lnx.nav.navigate(navId)
    },
	
	destroy : function( type ){
		
	}	
	
};


lnx.quickCheck = {
   
    complete: false,

    init : function( node, screenElm, frameElm ){

        //lnx.nav.takingTest(true);
        this.scrId = screenElm.getAttribute("id");
        this.complete = this.enabled = ((lnx.cache.getValue("complete", this.scrId) === true) || !lnx.nav.getIsScreenLocked());       
        if(!this.enabled && !lnx.nav.getIsCompleteAllScreens()){
            this.enabled = true;
        }      
        this.quickCheckOptions = Array.from(screenElm.querySelectorAll(".qOption"));	
        if(!this.enabled){
            this.quickCheckOptions.forEach((v)=>{v.classList.add("qOptionDisabled")});
        }
        this.submitBtn = screenElm.querySelector("button.qcSubmitBtn");
        this.submitBtn.setAttribute("disabled","true");
        this.correctAns = screenElm.querySelector(".quickCheck").getAttribute("data-correctAns").split(",");
        this.isRadio = (this.correctAns.length < 2);
        this.resultCirc = screenElm.querySelector(".qcResultCirc");
        this.resultImgs = Array.from(screenElm.querySelectorAll(".qcInCorrect", ".qcCorrect"));
        this.quesImage = screenElm.querySelector(".qcQuesImg");
        this.resultImgs.push(screenElm.querySelector(".qcCorrect"));
        this.feedback = screenElm.querySelector(".qcFeedback");
        this.feedbackCon = screenElm.querySelector(".qcFeedback > div");
        this.feedbackLine = screenElm.querySelector(".qcFeedback > hr");
        this.feedbackHeaders = Array.from(screenElm.querySelectorAll(".qcFeedback > div > p"));
        this.activated = false;
        this.selected = [];
        lnx.util.updateEventListener(this.quickCheckOptions, "click", this.onSelect.bind(this));
        lnx.util.updateEventListener(this.submitBtn, "click", this.onSubmit.bind(this));
        this.fbAudio = screenElm.querySelector(".qcFeedback").getAttribute("data-audio");
        var audio = screenElm.querySelector(".quickCheck").getAttribute("data-audio");
        var delay = screenElm.querySelector(".quickCheckIntro") ? 1700 : 200;
        lnx.audio.playAudio(audio, delay);
    },

    onSelect: function(e){
        
        var self = this;
        if(!this.enabled) return;

        if(!this.activated){
            this.submitBtn.removeAttribute("disabled");
            this.activated = true;
        }

        var opt = e.currentTarget;
        var optNum = opt.getAttribute("data-optNum");
        if(this.isRadio){
            setRadioState(opt);
        } else {
            if(removeOrAdd(optNum)){
                opt.classList.toggle("surveyOptionSelected");
                }
            }

        function setRadioState(o){
           
            if(!self.selected.length){
                self.selected[0] = optNum;
                o.classList.toggle("surveyOptionSelected");
        } else {
                var t = getOptionElm(self.selected[0]);
                t.classList.toggle("surveyOptionSelected");
                self.selected[0] = optNum;
                o.classList.toggle("surveyOptionSelected");
        }
                }

        function getOptionElm(n){
            return self.quickCheckOptions[parseInt(n) - 1];
        }

        function removeOrAdd(n){
            var s = self.selected;
            var i = s.indexOf(n);
            if(i !== -1 && s.length === 1){
                //nothing to do
                return false;
            } 
            if(i === -1){
                s.push(n);
            } else {
                s.splice(i, 1);
            }
            return true;      
        }
    },

    showResult: function(r){
        var self = this;
        var c = r ? "qcResultCircCorrect" : "qcResultCircInCorrect";
        this.resultCirc.classList.remove("qcResultCircCorrect", "qcResultCircInCorrect");
        setTimeout(function(){self.resultCirc.classList.add(c);},100);
        this.resultImgs.forEach((v)=>{v.classList.remove("qcShowImg")});
        var i = r ? 1 : 0;
        this.resultImgs[i].classList.add("qcShowImg");
        this.quesImage.classList.add("qcHideImg");
        this.feedbackCon.classList.add("removeClipPath");
        this.feedbackLine.classList.add("moveFeedbackLine");
        this.feedbackHeaders.forEach((v)=>{v.classList.remove("qcShow")});
        i = r ? 0 : 1;
        this.feedbackHeaders[i].classList.add("qcShow");
        lnx.audio.playAudio(r ? "Correct" : "Not_Correct");
        var audio = this.fbAudio;
        var delay = r ? 1600 : 2100;
        this.timeOutCode = setTimeout(function(){lnx.audio.playAudio(audio)}, delay);
    }, 

    onSubmit: function(e){
       
        var result = false;
        var uc = this.quickCheckOptions[0].parentNode.getAttribute("data-selectedoption");
        if(this.selected.sort().join(",") === this.correctAns.sort().join(",")){
            result = true;
        }
        
        this.complete = true;
        lnx.cache.setValue("complete", this.scrId, true);
        lnx.view.onScreenComplete();
        
        this.showResult(result);
    },
    
    hasContent : function(){		
        return false;
    },

    isComplete: function(){
        return this.complete;
    },

    onAudioFinish: function(){
        this.enabled = true;
        this.quickCheckOptions.forEach((v)=>{v.classList.remove("qOptionDisabled")});
    },

    OnNavEventRejectedNotice: function(){
        //lnx.view.showUserNoticeGen("You must complete this exercise before moving forward.");
    },
    
    destroy : function( type ){
        clearTimeout(this.timeOutCode);
        this.timeOutCode = null;
    }	
};

lnx.confirmation = {
	
    complete: false,

	init : function( node, screenElm, frameElm ){
        this.scrId = screenElm.getAttribute("id");
		this.confirmBtn = screenElm.querySelector("button");
        this.confirmBtn.addEventListener("click", this.onSubmit.bind(this));
        this.isCourseCompletion = node.getAttribute("subType") === "2";
	},
	
    onSubmit: function(e){
        if(this.isCourseCompletion){
            var result = this.doCourseCompletion();
            if(!result){
                return;
            }
        }
        this.complete = true;
        lnx.cache.setValue("complete", this.scrId, true);
        lnx.view.onScreenComplete();
        lnx.nav.navigate("next");
    },

    doCourseCompletion: function(){
        var r = lnx.scormApi.lmsCompleteCourse(true);
        if(r){
            return true;
        } else {
            alert("The LMS did not confirm completion. Please try again later.");
            return false;
        }
    },

	hasContent : function(){		
		return false;
	},

	isComplete: function(){
		return complete;
	},

    onAudioFinish: function(){
        // presence required but doesn't need to do anything
    },

	
	destroy : function( type ){
		this.confirmBtn = null;
	}	
	
};

lnx.animVer = {
    screen: 0,
    numScreens: 2,

    init : function( node, screenElm, frameElm, origNavId){
		var self = this;
        this.id = screenElm.getAttribute("id");    
        this.resId = node.getAttribute("resId");
        this.con = screenElm.querySelector(".animVerContainer");
        this.con2 = screenElm.querySelector(".animVerContainer2");
        this.text = screenElm.querySelector(".animVerText");
        this.text2 = screenElm.querySelector(".animVerText2");
        this.screen = 0;
        var reverseIn = origNavId === "prev" && this.numScreens === 2; // must be reversing into activity so show last virtual screen
        var dir = reverseIn ? "prev" : "next";
        setTimeout(()=> self.insertVirtualScreen(dir, reverseIn));     
	},

    insertVirtualScreen: function(dir, showFinalReverse){        
        if(showFinalReverse){
            // screen will be decrimented to correct value below in "prev" conditional
            this.screen = this.numScreens + 1;            
        }        
       if(dir === "next"){
            if(this.screen < this.numScreens){
                this.screen++;
                this.updateVirtualScreen(dir);
                return true;
            }else{
                return false;
            }
       }else if(dir === "prev"){
            if(this.screen <= 1){
                return false;
            }else{
                this.screen--;
                this.updateVirtualScreen(dir);
                return true;
            }       
        }else{
            return false;
        }
    },

    updateVirtualScreen: function(dir){
        
        var self = this;
        var img = this.con.querySelectorAll("img");
        var p = this.con.querySelectorAll("div > p");
        var bars = this.con.querySelectorAll("div");
        var bars2 = this.con2.querySelectorAll("div");
        
        switch(this.screen){
            case 1:{
                if(dir === 'prev'){
                    showScreen1();
                }
                p.forEach((v)=>{v.classList.add("removeAnimVerPClipPath")});
                setTimeout(showPillars1, 6800);
                break;
            };
            case 2:{
                img.forEach((v)=>{v.classList.remove("transPillar")});
                prepScreen2();
                setTimeout(showScreen2, 700);
                setTimeout(hideScreen1, 900);                
                swapText();
                break;
            }
        }       

        function showPillars1(){
            img.forEach((v)=>{v.classList.add("transPillar")});
        }

        function showPillars2(){
            img = self.con2.querySelectorAll("img");
            img.forEach((v)=>{v.classList.add("transPillar")});
        }

        function hideScreen1(){
            self.con.classList.add("opacity0");           
        }

        function showScreen1(){
            self.con.classList.remove('opacity0');
            self.con2.classList.remove('showImp');  
            self.text.classList.remove('hide');
            self.text2.classList.remove('showImp');          
        }

        function prepScreen2(){
            self.con2.classList.add("opacity0");
            self.con2.classList.add('showImp');
        }

        function showScreen2(){
            self.con2.classList.remove("opacity0");            
            setTimeout(moveBars2, 1000);
            setTimeout(showPillars2, 1300);
        }

        function moveBars2(){
            bars2.forEach((v)=>{v.classList.add("transBar2")});
        }

        function swapText(){
            self.text.classList.add('hide');
            self.text2.classList.add('showImp');
        }

        this.playAudio();
    },

    getResId: function(){
        return this.resId + "_" + this.screen;
    },

    playAudio: function(){
        var delay = this.screen === 1 ? 1200 : 2300;
        lnx.audio.playAudio(this.getResId(), delay);
    },
	
	hasContent : function(){		
		return false;
	},

	isComplete: function(){
		return true;
	},

    isFinalScreen: function(){
        return this.screen >= this.numScreens;
    },
	
	destroy : function( type ){
		this.con = this.con2 = this.text = this.text2 = null;
	}	
};

lnx.clickAndAnimateText = {
    
    items : [],
    handlers: [],    
    hasAudio: false,
    openItem: null,
    
    init : function( node, screenElm, frameElm ){
    
        var self = this;
        // get clickable items
        var set = screenElm.querySelectorAll("div.clickable");
        for(var i = 0, len = set.length; i < len; i++ ){
            this.items.push(set[i]);
        }
        this.complete = false;
        this.current = null;
        this.scrId = screenElm.getAttribute("id"); 
        this.resId = node.getAttribute("resId");
       
        lnx.util.updateEventListener(this.items, "click", this.onSelection);

        this.message = screenElm.querySelector(".userNotice");
    },
    
    OnNavEventRejectedNotice: function(dir){
        this.message.classList.add("showUserNotice");
    },
    
    onSelection : function( e ){
        
        e = e || window.event;
        var audio = true;
        var self = lnx.clickAndAnimateText;        
        self.message.classList.remove("showUserNotice");
        if(self.current){
            self.current.classList.remove("texSecActive");
        }
        if(self.current === e.currentTarget.firstChild){
            self.current = null;
            lnx.audio.stopAudio();
            return;
        }
        var num = e.currentTarget.getAttribute("data-optionNum");
        
        e.currentTarget.setAttribute("data-complete", "true");
        e.currentTarget.firstChild.classList.add("texSecActive");
        self.current = e.currentTarget.firstChild;

        e.currentTarget.querySelector(".texSecComplete").classList.add("visImp");

        if(audio){
            self.hasAudio = true;
            var id = self.resId + "_" + num;
            lnx.audio.playAudio(id);
        }

        if(!self.complete){
            checkForCompletion();
        }
                    
        e.stopPropagation ? 
        e.stopPropagation() : ( e.cancelBubble = true );
        
        e.preventDefault ?
        e.preventDefault() : ( e.returnValue = false );
        return false;

        function checkForCompletion(){
            var complete = true;
            for(var i=0;i<self.items.length;i++){
                if(self.items[i].getAttribute("data-complete") !== "true"){
                    complete = false;
                    break;
                }
            }
            if(complete){
                self.complete = complete;
                lnx.cache.setValue("complete", self.scrId, true);
                lnx.view.onScreenComplete();
            }
            return complete;
        }
        
    },    

    onAudioFinish: function(){
        // presence required but doesn't need to do anything
    },    
    
    hasContent : function(){
        
        return false;
    },
    
    
    destroy : function(){
        
        lnx.util.updateEventListener(this.items, "click", this.onSelection, true);
        this.current = null;
        this.items = []; 
        this.handlers = [];
        this.hasAudio = false;
    }
};

lnx.sliderIcons = {

    screen: 0,
    numScreens: 3,

    init : function( node, screenElm, frameElm, origNavId){
        screenElm = node = document.querySelector(".sliderContainer");
        
        var self = this;        
        this.message = screenElm.querySelector(".userNotice");
        this.scrId = screenElm.getAttribute("id");    
        this.resId = node.getAttribute("resId");
        this.complete = lnx.cache.getValue("complete", this.scrId) === true;
        this.screen = 0;

        let tl = null;
        let slContent = null;
        this.intro = screenElm.querySelector('.sliderImgContainer');
        this.main = screenElm.querySelector('.sliderOuterContentContainer');
        this.iconContainer = screenElm.querySelector('.sliderIconContainer');     
        this.items =  this.iconContainer.querySelectorAll('.sliderIcon');
        this.iconContainer.addEventListener('click', onIconClick);

        var reverseIn = origNavId === "prev"; // must be reversing into activity so show last virtual screen
        var dir = reverseIn ? "prev" : "next";

        setTimeout(()=> self.insertVirtualScreen(dir, reverseIn));

        function onIconClick(e){

            let tg = null;
            if(e.target.classList.contains('sliderIcon')){
                tg = e.target;
            } else {
                let t = e.target;
                while(t !== e.currentTarget){
                    t = t.parentNode;
                    if(t.classList.contains('sliderIcon')){
                        tg = t;
                        break;
                    }
                }
            }
            if(tg){
                tg.setAttribute("data-complete", "true");
                tg.querySelectorAll("img")[1].style.visibility = "visible";
                let num = parseInt(tg.getAttribute("data-target"));
                slContent = screenElm.querySelectorAll('.sliderContent')[num-1];
                let bcr1 = slContent.parentNode.getBoundingClientRect();
                
                let outer = 1200;
                let bcr = tg.getBoundingClientRect();
                let r = bcr.width/2;
                let x = (bcr.x + bcr.width /2) - bcr1.x;
                let y = (bcr.y + bcr.height /2) - bcr1.y;

                tl = gsap.timeline();
                tl.set(slContent, {autoAlpha: 1});
                tl.fromTo(slContent, {display: "block", clipPath: `circle(${r}px at ${x}px ${y}px)`, filter: "grayscale(1)" }, {clipPath: `circle(${outer}px at ${x}px ${y}px)`, filter: "grayscale(0)", duration: 1.5, ease: "power3.in", onComplete: onComplete, onReverseComplete: onReverseComplete});

                let rs = slContent.querySelector('.sliderRoundShape');
                let tx = slContent.querySelector('.sliderTextContainer');
                let close = slContent.querySelector('img.slClose');
                let vBar = slContent.querySelector('.sliderVerticalBar');
                close.onclick = onClose;
                let tl2 = gsap.timeline();
                let dx = .25;
                tl2.set([tx,close,vBar], {x: `${dx}%`, opacity: 0}); // fix to force browser  render text
                let dir = (slContent.classList.contains('slLeft') === true) ? "" : "-";
                tl2.from(rs, {scale: 1.3, x: `${dir}120%`, delay: 1.6, duration: 1.2, ease: "power2.inOut"});
                tl2.to([tx,close,vBar], {opacity: 1, duration: 1});

                checkForCompletion();
            }
        }

        function onClose(e){
            tl.reverse();
        }

        function onComplete(e){
            //console.log('complete');                    
        }

        function onReverseComplete(e){
            let tl3 = gsap.timeline();
            tl3.to(slContent, {autoAlpha: 0});
            tl3.set(slContent, {display: "none"});
        }

        function checkForCompletion(){
            var complete = true;
            for(var i=0;i<self.items.length;i++){
                if(self.items[i].getAttribute("data-complete") !== "true"){
                    complete = false;
                    break;
                }
            }
            if(complete){
                self.complete = complete;
                lnx.cache.setValue("complete", self.scrId, true);
                lnx.view.onScreenComplete();
            }
            return complete;
        }
            
    },

    insertVirtualScreen: function(dir, showFinalReverse){        
        if(showFinalReverse){
            // screen will be decrimented to correct value below in "prev" conditional
            this.screen = this.numScreens + 1;            
        }
        
        if(dir === "next"){
                if(this.screen < this.numScreens){
                    this.screen++;
                    this.updateVirtualScreen(dir);
                    return true;
                }else{
                    // if(!this.complete){
                    //     this.OnNavEventRejectedNotice();
                    //     return true;
                    // }
                    return false;
                }
        }else if(dir === "prev"){
            if(this.screen <= 1){
                return false;
            }else{
                this.screen--;
                this.updateVirtualScreen(dir);
                return true;
            }       
        }else{
            return false;
        }
    },

    updateVirtualScreen: function(dir){
    
        var right = this.isRhs ? "Right" : "";
        if(dir === "next"){
            switch(this.screen){
                case 1:{
                    //nothing to do
                    break;
                }
                case 2:{
                    let tl = gsap.timeline();
                    tl.to(this.intro, {x: "-35%", ease:"power1.inOut", duration: 1});
                    break;
                }
                case 3:{
                    let tl = gsap.timeline();
                    tl.to(this.main, {autoAlpha: 1});
                    let icons = this.iconContainer.querySelectorAll(".sliderIcon");
                    let p = this.iconContainer.querySelectorAll(":scope > p");
                    tl.from([icons,p], {opacity: 0, stagger:{amount: .7, from: "random"}, duration: 1});
                    break;
                }
            }
        } else {
            switch(this.screen){
                case 1:{
                    let tl = gsap.timeline();
                    tl.to(this.intro, {x: 0, ease:"power2.inOut", duration: 1.2});
                    break;
                }
                case 2:{
                    let tl = gsap.timeline();
                    tl.set(this.intro, {x: "-35%"});
                    tl.to(this.main, {autoAlpha: 0});
                    let icons = this.iconContainer.querySelectorAll(".sliderIcon");
                    let p = this.iconContainer.querySelectorAll(":scope > p");                   
                    break;
                }
                case 3:{
                    let tl = gsap.timeline();
                    tl.to(this.main, {autoAlpha: 1});
                    let icons = this.iconContainer.querySelectorAll(".sliderIcon");
                    let p = this.iconContainer.querySelectorAll(":scope > p");
                    tl.from([icons,p], {opacity: 0, stagger:{amount: .7, from: "random"}, duration: 1});
                    break;
                }
            }
        }
        
        this.playAudio();
    },

    getResId: function(){
        return this.resId + "_" + this.screen;
    },

    playAudio: function(){
        var delay = this.screen === 1 ? 1500 : 0;
        lnx.audio.playAudio(this.getResId(), delay);
    },
    
    hasContent : function(){		
        return false;
    },

    isComplete: function(){
        return true;
    },

    OnNavEventRejectedNotice: function(dir){
        console.log('navreject',dir);
        //this.message.classList.add("showUserNotice");
    },
    
    destroy : function( type ){
        this.items = [];
    }	
};

       


// handle window events

window.onerror = function( m, u, l ){
	
	lnx.util.onWinErr( m, u, l );
};


window.onload = function(){ 

	lnx.init();//lnx.util.init();
};	


window.onbeforeunload = function(e){
    var elm = (e.target && e.target.activeElement) || document.activeElement;
    if(elm && elm.tagName.toLowerCase() === 'a' && elm.href.indexOf('mailto:') > -1){
        return;
    }
    lnx.exit();
}

window.onunload = function(){
	
	lnx.exit();
};

//force update

/*window.onbeforeunload = function(){
	
	//lnx.exit();
}*/