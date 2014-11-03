function changeMargins() {
	var total_w = $('#Media').width();
	var cells = $('#Media li'),
		aspect = new Array(cells.length),
		images_w = 0, row_h = 180, row_start = 0, spaces = 1;

	for(var i=0; i < cells.length; i++) {
		var thumb = $(cells[i]).find('.thumb')[0];
		aspect[i] = thumb.naturalWidth / thumb.naturalHeight;
		images_w += (180 * aspect[i]);
		var avail_w = total_w - ++spaces * 20;
		var wrap = images_w > avail_w;
		if (wrap || i == cells.length - 1) {
			if (wrap) {
				row_h = avail_w / images_w * 180;
			}
			// Normalize cell heights for current row
			for(var c=row_start; c <= i; c++) {
				var cell_w = row_h * aspect[c],
					caption_w = cell_w - 32;
				$(cells[c]).find('.caption').css({
					width : caption_w + 'px',
					maxWidth : caption_w + 'px',
				});
				$(cells[c]).find('.thumb').css({
					width : 'auto',
					height : row_h + 'px',
					maxWidth : cell_w + 'px',
					maxHeight : row_h + 'px',
				});
			}
			images_w = 0;
			row_start = i + 1;
			spaces = 1;
		}
	}
}

$(document).ready(function() {
	if ($('#Media').length) {
		$(window).bind('load resize', changeMargins);
	}
	if ($('#Folders').length) {
		$('#Folders li').bind('contextmenu', function(){
			return false;
		});
	}
});

function searchFun(url) {
	var str = prompt("Enter search string:");
	if (str !== null) {
		window.location.assign(url+'?str='+str)
	}
	return false;
}
