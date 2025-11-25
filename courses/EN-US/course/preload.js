var lnx_preload = {
	
	folder : "./images/",
	
	images : [
	
	],
	//images : [],
	
	run : function(){
		
		for( var i = 0, len = this.images.length; i < len; i++ ){

			var img = (new Image()).src = this.folder + this.images[i];
		}
	}
};
