var traverse = require("traverse"),
dref         = require("dref"),
_            = require("underscore"),
deepExtend   = require("deep-extend");




module.exports = function(target) {

	if(isCore(target)) return target;

	//an array? map 
	if(target instanceof Array) {
		return target.map(module.exports);
	}

		
	//must already be wrapped, or have a toPublic method
	//this is important so we don't send huge objects - private
	//objects over the network
	if(!target.toPublic && !target.__wrapped) return {};

	//the public target IS the target if it's already been wrapped. If it's wrapped, we're
	//assuming it's been passed over the wire
	var publicTarget = target.__wrapped ? target : target.toPublic(),

	//assign a NEW target that'll get returned
	wrappedTarget = {
		__wrapped: true,

		//used to flag any values that have been changed
		__changed: function(values) {

			//already wrapped? probably an object passed over the wire. It SHOULD
			//be over the wire, otherwise __changed will be called more than it needs to be.
			if(publicTarget.__changed) publicTarget.__changed(values);

			_.extend(publicTarget, values);
		}
	},

	//the obj that keeps track of any changes to the object
	template;

	//next need to go through every attribute, and wrap it up
	traverse(publicTarget).forEach(function(v) {

		//make sure not to accept ANY properties with a an underscore for a prefix (_private, _connection, etc.).
		//If it's an object, we also want to skip it since it'll be traversed later. Setting the original object
		//will allow the wrappedTarget to override any values - we don't want that.
		if(isPrivate(this) || typeof v == "object") return;

		var path = this.path.join(".");

		//not a function, or object? set the value.
		if(typeof v !== "function") return dref.set(wrappedTarget, path, v);

		//need this to keep the original function intact
		var parent   = dref.get(publicTarget, this.path.slice(0, this.path.length - 1));

		//wrap the function up. ANY param values need to go through dsync again since this callback
		//maybe mushing stuff over the wire again
		dref.set(wrappedTarget, path, function() {

			//trigger any changes that might have happened - these changes SHOULD be called before the next function
			//even over the network
			triggerChanged();

			//wrap the args
			var args = Array.prototype.slice.call(arguments, 0).map(module.exports);

			//call the prev function
			v.apply(parent, args);
		});
	});

	function triggerChanged() {
		var changed = difference(template, wrappedTarget),
		changedSize = traverse(changed).nodes().length;
		if(changedSize) {
			wrappedTarget.__changed(changed);
			resetTemplate();
		}
	}

	function resetTemplate() {
		template = traverse(wrappedTarget).clone();
	}

	resetTemplate();


	return wrappedTarget;
}



function isCore(target) {
	var tot = typeof target;
	return !target ||
	target instanceof Error ||
	/string|number/.test(tot);
}

function difference(template, override) {
    var ret = {};
    for (var name in template) {
        if (name in override) {
            if (_.isObject(override[name]) && !_.isArray(override[name])) {
                var diff = difference(template[name], override[name]);
                if (!_.isEmpty(diff)) {
                    ret[name] = diff;
                }
            } else if (!_.isEqual(template[name], override[name])) {
                ret[name] = override[name];
            }
        }
    }
    return ret;
}

function isPrivate(leaf) {
	return !!_.find(leaf.path, function(key) {
		return key.substr(0, 1) === "_";
	})
}