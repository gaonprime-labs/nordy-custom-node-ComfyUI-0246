import { app } from "../../../scripts/app.js";
import { ComfyDialog } from "../../../scripts/ui.js";

function error_popup(msg) {
	let dialog = new ComfyDialog();
	dialog.show(`<p>${msg}</p>`);
}

function hijack(obj, key, before_func, after_func) {
	const old_func = obj[key] ?? (() => {});
	obj[key] = function () {
		before_func.apply(this, arguments);
		old_func.apply(this, arguments);
		after_func.apply(this, arguments);
	};
}

function removeElements(array, isValid) {
	let shift = 0;

	for (let i = 0; i < array.length; ++ i) {
		if (isValid(array[i]))
			++ shift;
		else if (shift > 0)
			array[i - shift] = array[i];
	}

	array.length -= shift;
}

async function randomSHA256() {
	// Generate a random array of bytes
	const randomValues = new Uint8Array(32);
	window.crypto.getRandomValues(randomValues);

	// Convert the random bytes to a string
	const randomString = Array.from(randomValues).map(b => String.fromCharCode(b)).join('');

	// Hash the string using SHA-256
	const msgBuffer = new TextEncoder().encode(randomString); // encode as (utf-8) Uint8Array
	const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer); // hash the message

	// Convert the buffer to hex string
	const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
	const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
	return hashHex;
}

/////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////

function init_type(node) {
	node.addCustomWidget({
		name: "_type",
		computeSize: () => [0, -4],
		async serializeValue (node, index_str) {
			return serialize_type(node);
		}
	});
}

function init_update(node, name) {
	node.__update = false;
	for (let i = 0; i < node.widgets.length; ++ i) {
		if (node.widgets[i].name === name) {
			node.widgets[i].serializeValue = async function (inner_node, index_str) {
				if (node.__update || !node.__hash_update)
					node.__hash_update = await randomSHA256();
				node.__update = false;
				return {
					data: this.value,
					update: node.__hash_update,
				};
			};
			return;
		}
	}
}

function serialize_type(node) {
	let data = {
		in: [],
		out: []
	}
	for (let i = 0; i < node.inputs.length; ++ i) {
		if (BLACKLIST.includes(node.inputs[i].name))
			continue;
		data.in.push({
			name: node.inputs[i].orig_name,
			full_name: node.inputs[i].name,
			type: node.inputs[i].type,
		});
	}
	for (let i = 0; i < node.outputs.length; ++ i) {
		if (BLACKLIST.includes(node.outputs[i].name))
			continue;
		data.out.push({
			name: node.outputs[i].orig_name,
			full_name: node.outputs[i].name,
			type: node.outputs[i].type,
		});
	}
	return data;
}

function link_shift_up(self, arr, index, flag, link_callback) {
	// Disconnect event handler
	const old_func = self.onConnectionsChange;
	self.onConnectionsChange = null;
	const old_in_func = self.onConnectInput;
	self.onConnectInput = null;
	const old_out_func = self.onConnectOutput;
	self.onConnectOutput = null;

	// Shift up all links

	if (flag) {
		if (arr[index].links.length === 0) {
			self.removeOutput(index);
			for (let i = 0, c = 0; i < arr.length; ++ i) {
				if (BLACKLIST.includes(arr[i].name))
					continue;
				arr[i].name = `${arr[i].type}:${c}`;
				++ c;
			}
		}
	} else {
		self.removeInput(index);

		for (let i = 0, c = 0; i < arr.length; ++ i) {
			if (BLACKLIST.includes(arr[i].name))
				continue;
			arr[i].name = `${c}:${arr[i].type}`;
			++ c;
		}
	}
	
	// Revert things back
	self.onConnectionsChange = old_func;
	self.onConnectInput = old_in_func;
	self.onConnectOutput = old_out_func;

	return;
}

const BLACKLIST = [
	"_way_in",
	"_way_out",
	"_junc_in",
	"_junc_out",
	"_query",
	"_offset",
	"..."
];

const LEGACY_BLACKLIST = {
	prev: ["_pipe_in", "_pipe_out"],
	next: ["_way_in", "_way_out"],
};

app.registerExtension({
	name: "0246.Node",
	nodeCreated(node) {
		switch (node.getTitle()) {
			case "Highway": {
				node.color = LGraphCanvas.node_colors.brown.color;
				node.bgcolor = LGraphCanvas.node_colors.brown.bgcolor;
			} break;
			case "Junction": {
				node.color = LGraphCanvas.node_colors.blue.color;
				node.bgcolor = LGraphCanvas.node_colors.blue.bgcolor;
			} break;
		}
	},
	async beforeRegisterNodeDef (nodeType, nodeData, app) {
		if (nodeData.category === "0246") {
			switch (nodeData.name) {
				case "Highway": {
					nodeType.prototype.onNodeMoved = function () {};

					nodeType.prototype.onNodeCreated = function () {
						hijack(this, "configure", () => {}, function (data) {
							// Patch legacy nodes
							for (let i = 0; i < this.inputs.length; ++ i) {
								if (LEGACY_BLACKLIST.prev.includes(this.inputs[i].name))
									this.inputs[i].name = LEGACY_BLACKLIST.next[i];
							}
							for (let i = 0; i < this.outputs.length; ++ i) {
								if (LEGACY_BLACKLIST.prev.includes(this.outputs[i].name))
									this.outputs[i].name = LEGACY_BLACKLIST.next[i];
							}
						});

						let last_query = "";

						init_type(this);

						init_update(this, "_query");

						this.addWidget("button", "Update", null, () => {
							const query = this.widgets.find(w => w.name === "_query");

							// POST query to server
							fetch(window.location.origin + "/0246-parse", {
								method: "POST",
								headers: {
									"Content-Type": "application/json",
								},
								body: JSON.stringify({
									"input": query.value,
								}),
							}).then(response => {
								if (response.ok) {
									return response.json();
								} else {
									throw new Error("Network response was not ok.");
								}
							}).then(data => {
								if (data.error.length > 0) {
									error_popup(data.error.join("\n"));
									query.value = last_query;
									return;
								}

								this.__update = true;

								last_query = query.value;

								let prev = [];

								// Save previous inputs and outputs
								for (let i = 0; i < this.inputs.length; ++ i) {
									if (!BLACKLIST.includes(this.inputs[i].name) && this.inputs[i].link !== null)
										prev.push({
											flag: false,
											name: this.inputs[i].orig_name,
											node_id: app.graph.links[this.inputs[i].link].origin_id,
											slot_id: app.graph.links[this.inputs[i].link].origin_slot,
										});
								}
								for (let i = 0; i < this.outputs.length; ++ i) {
									if (!BLACKLIST.includes(this.outputs[i].name) && this.outputs[i].links !== null)
										for (let j = 0; j < this.outputs[i].links.length; ++ j)
											prev.push({
												flag: true,
												name: this.outputs[i].orig_name,
												node_id: app.graph.links[this.outputs[i].links[j]].target_id,
												slot_id: app.graph.links[this.outputs[i].links[j]].target_slot,
											});
								}

								// Clear all inputs and outputs except any that in BLACKLIST
								for (let i = this.inputs.length; i -- > 0;) {
									if (!BLACKLIST.includes(this.inputs[i].name))
										this.removeInput(i);
								}
								for (let i = this.outputs.length; i -- > 0;) {
									if (!BLACKLIST.includes(this.outputs[i].name))
										this.removeOutput(i);
								}

								// Add new inputs and outputs
								for (let i = 0; i < data.order.length; ++ i) {
									switch (data.order[i][0]) {
										case "set": {
											this.addInput(`+${data.order[i][1]}`, "*");
										} break;
										case "get":{
											this.addOutput(`-${data.order[i][1]}`, "*");
										} break;
										case "eat": {
											this.addOutput(`!${data.order[i][1]}`, "*");
										} break;
									}
								}

								for (let i = 0; i < this.inputs.length; ++ i)
									this.inputs[i].orig_name = this.inputs[i].name;
								for (let i = 0; i < this.outputs.length; ++ i)
									this.outputs[i].orig_name = this.outputs[i].name;

								// Restore previous inputs and outputs
								for (let i = 0; i < prev.length; ++ i) {
									// Check if input/output still exists
									if (prev[i].flag) {
										for (let j = 0; j < this.outputs.length; ++ j) {
											if (this.outputs[j].orig_name === prev[i].name) {
												this.connect(
													j,
													prev[i].node_id,
													prev[i].slot_id
												);
												break;
											}
										}
									} else {
										for (let j = 0; j < this.inputs.length; ++ j) {
											if (this.inputs[j].orig_name === prev[i].name) {
												app.graph.getNodeById(prev[i].node_id).connect(
													prev[i].slot_id,
													this,
													j
												);
												break;
											}
										}
									}
								}
							});
						});

						this.onConnectInput = function (
							this_target_slot_index,
							other_origin_slot_type,
							other_origin_slot_obj,
							other_origin_node,
							other_origin_slot_index
						) {
							this.__update = true;

							if (BLACKLIST.includes(this.inputs[this_target_slot_index].name))
								return true;

							if (this.inputs[this_target_slot_index].link !== null) {
								// Prevent premature link kill
								app.graph.links[this.inputs[this_target_slot_index].link].replaced = true;
								return true;
							}
							
							let curr_pin = this.inputs[this_target_slot_index];
							curr_pin.type = other_origin_slot_obj.type;
							curr_pin.name = `${curr_pin.orig_name}:${curr_pin.type}`;

							return true;
						};

						this.onConnectOutput = function (
							this_origin_slot_index,
							other_target_slot_type,
							other_target_slot_obj,
							other_target_node,
							other_target_slot_index
						) {
							// We detect if we're connecting to Reroute here by checking other_target_node.type === "Reroute"
							// return false for not allowing connection
							this.__update = true;
							
							if (BLACKLIST.includes(this.outputs[this_origin_slot_index].name))
								return true;

							let curr_pin = this.outputs[this_origin_slot_index];

							if (other_target_node.__outputType) // Reroute
								curr_pin.type = other_target_node.__outputType;
							else if (other_target_node.defaultConnectionsLayout) // Reroute (rgthree)
								// rgthree accept this anyways so whatever since too lazy to properly do graph traversal
								// EDIT: I was wrong, I have to do it, but not here :(
								curr_pin.type = other_target_slot_obj.type; 
							else
								curr_pin.type = other_target_slot_obj.type;

							curr_pin.name = `${curr_pin.type}:${curr_pin.orig_name}`;

							return true;
						};

						this.onConnectionsChange = function (type, index, connected, link_info) {
							if (link_info === null) {
								// Clean up when copy paste or template load
								for (let i = 0; i < this.inputs.length; ++ i)
									if (!BLACKLIST.includes(this.inputs[i].name)) {
										this.inputs[i].name = this.inputs[i].orig_name;
										this.inputs[i].type = "*";
									}
								for (let i = 0; i < this.outputs.length; ++ i)
									if (!BLACKLIST.includes(this.outputs[i].name)) {
										this.outputs[i].name = this.outputs[i].orig_name;
										this.outputs[i].type = "*";
									}
								this.computeSize();
								return;
							}

							if (!connected) {
								switch (type) {
									case 1: {
										if (BLACKLIST.includes(this.inputs[link_info.target_slot].name) || link_info.replaced)
											return;
										this.inputs[link_info.target_slot].name = this.inputs[link_info.target_slot].orig_name;
										this.inputs[link_info.target_slot].type = "*";
									} break;
									case 2: {
										if (this.outputs[link_info.origin_slot].links.length === 0 && !BLACKLIST.includes(this.outputs[link_info.origin_slot].name)) {
											this.outputs[link_info.origin_slot].name = this.outputs[link_info.origin_slot].orig_name;
											this.outputs[link_info.origin_slot].type = "*";
										}
									} break;
									default: {
										throw new Error("Unsuported type: " + type);
									}
								}
							}
						};
					};
				} break;
				case "Junction": {
					nodeType.prototype.onNodeMoved = function () {};

					nodeType.prototype.onNodeCreated = function () {
						init_type(this);

						init_update(this, "_offset");

						this.addInput("...", "*");
						this.addOutput("...", "*");

						let real_inputs = 0,
							real_outputs = 0;

						hijack(this, "configure", () => {}, function (data) {
							// Count real inputs and outputs
							for (let i = 0; i < this.inputs.length; ++ i) {
								if (!BLACKLIST.includes(this.inputs[i].name))
									++ real_inputs;
							}
							for (let i = 0; i < this.outputs.length; ++ i) {
								if (!BLACKLIST.includes(this.outputs[i].name))
									++ real_outputs;
							}
						});

						this.onConnectInput = function (
							this_target_slot_index,
							other_origin_slot_type,
							other_origin_slot_obj,
							other_origin_node,
							other_origin_slot_index
						) {
							this.__update = true;

							if (
								BLACKLIST.includes(this.inputs[this_target_slot_index].name) &&
								this.inputs[this_target_slot_index].name !== "..."
							)
								return true;

							if (this.inputs[this_target_slot_index].link !== null) {
								app.graph.links[this.inputs[this_target_slot_index].link].replaced = true;
								return true;
							}
							
							let curr_pin = this.inputs[this_target_slot_index];
							curr_pin.type = other_origin_slot_obj.type;
							curr_pin.name = `${real_inputs ++}:${curr_pin.type}`;

							this.addInput("...", "*");

							return true;
						};

						this.onConnectOutput = function (
							this_origin_slot_index,
							other_target_slot_type,
							other_target_slot_obj,
							other_target_node,
							other_target_slot_index
						) {
							this.__update = true;

							if (
								BLACKLIST.includes(this.outputs[this_origin_slot_index].name) &&
								this.outputs[this_origin_slot_index].name !== "..."
							)
								return true;

							let curr_pin = this.outputs[this_origin_slot_index];

							if (curr_pin.links && curr_pin.links.length > 0)
								return true;

							if (other_target_node.__outputType) // Reroute
								curr_pin.type = other_target_node.__outputType;
							else if (other_target_node.defaultConnectionsLayout) // Reroute (rgthree)
								// Same thing here I guess
								curr_pin.type = other_target_slot_obj.type;
							else
								curr_pin.type = other_target_slot_obj.type;

							curr_pin.name = `${curr_pin.type}:${real_outputs ++}`;

							this.addOutput("...", "*");

							return true;
						};

						this.onConnectionsChange = function (type, index, connected, link_info) {
							if (link_info === null) {
								// Clean up when copy paste or template load
								removeElements(this.inputs, (e) => !BLACKLIST.includes(e.name));
								removeElements(this.outputs, (e) => !BLACKLIST.includes(e.name));
								this.computeSize();
								return;
							}
							
							if (!connected) {
								switch (type) {
									case 1: {
										if (BLACKLIST.includes(this.inputs[link_info.target_slot].name) || link_info.replaced)
											return;
										link_shift_up(this, this.inputs, link_info.target_slot, false, (link_index, extra_link_index) => {
											return this.inputs[link_index].link;
										});
										-- real_inputs;
									} break;
									case 2: {
										if (BLACKLIST.includes(this.outputs[link_info.origin_slot].name))
											return;
										if (!this.outputs[link_info.origin_slot].links || this.outputs[link_info.origin_slot].links.length === 0) {
											link_shift_up(this, this.outputs, link_info.origin_slot, true, (link_index, extra_link_index) => {
												return this.outputs[link_index].links[extra_link_index];
											});
											-- real_outputs;
										}
									} break;
									default: {
										throw new Error("Unsuported type: " + type);
									}
								}
							}
						};
					};
				} break;
			}
		}
	},
});