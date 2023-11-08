import { app } from "../../../scripts/app.js";
import { ComfyDialog } from "../../../scripts/ui.js";
import { ComfyWidgets } from "../../../scripts/widgets.js";

function error_popup(msg) {
	let dialog = new ComfyDialog();
	dialog.show(`<p>${msg}</p>`);
}

let rename_flag = false;

// Currently unused
function lock_name (obj) {
	Object.defineProperty(obj, "name", {
		get: function() {
			return this._name;
		},
		set: function(value) {
			if (rename_flag) {
				this._name = value;
			}
			return this._name;
		},
		enumerable: true,
		configurable: true
	});
}

const internal_widget_template = {
	type: "string",
	name: "__internal__",
	value: null,
	serialize_widgets: true,
	draw: null,
};

app.registerExtension({
	name: "0246.Node",
	nodeCreated(node) {
		switch (node.getTitle()) {
			case "Highway":
				node.color = LGraphCanvas.node_colors.brown.color;
				node.bgcolor = LGraphCanvas.node_colors.brown.bgcolor;
				break;
		}
	},
	async beforeRegisterNodeDef (nodeType, nodeData, app) {
		switch (nodeData.name) {
			case "Highway":
				nodeType.prototype.onNodeMoved = function () {
					console.log(this.pos[0]);
				}
				nodeType.prototype.onNodeCreated = function () {
					let type_data = {};

					this.widgets.push({
						name: "_internal",
						value: type_data,
						computeSize: () => [0, -4]
					});

					this.addWidget("button", "Update", null, () => {
						const query = this.widgets.find(w => w.name === "_query")["value"];

						// POST query to server
						fetch(window.location.origin + "/0246-parse", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								"input": query,
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
								return;
							}

							rename_flag = true;

							let prev = [];

							// Save previous inputs and outputs
							for (let i = 0; i < this.inputs.length; ++ i) {
								if (this.inputs[i].name[0] !== "_" && this.inputs[i].link !== null)
									prev.push({
										flag: false,
										name: this.inputs[i].orig_name,
										node_id: app.graph.links[this.inputs[i].link].origin_id,
										slot_id: app.graph.links[this.inputs[i].link].origin_slot,
									});
							}
							for (let i = 0; i < this.outputs.length; ++ i) {
								if (this.outputs[i].name[0] !== "_" && this.outputs[i].links !== null)
									for (let j = 0; j < this.outputs[i].links.length; ++ j)
										prev.push({
											flag: true,
											name: this.outputs[i].orig_name,
											node_id: app.graph.links[this.outputs[i].links[j]].target_id,
											slot_id: app.graph.links[this.outputs[i].links[j]].target_slot,
										});
							}

							// Clear all inputs and outputs except any that start with "_"
							for (let i = this.inputs.length; i -- > 0;) {
								if (this.inputs[i].name[0] !== "_")
									this.removeInput(i);
							}
							for (let i = this.outputs.length; i -- > 0;) {
								if (this.outputs[i].name[0] !== "_")
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

							for (let i = 0; i < this.inputs.length; ++ i) {
								// lock_name(this.inputs[i]);
								this.inputs[i].orig_name = this.inputs[i].name;
							}
							for (let i = 0; i < this.outputs.length; ++ i) {
								// lock_name(this.outputs[i]);
								this.outputs[i].orig_name = this.outputs[i].name;
							}

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

							rename_flag = false;
						});
					});

					this.onConnectionsChange = function (type, index, connected, link_info) {
						rename_flag = true;
						scope: {
							if (link_info instanceof Object) {
								switch (type) {
									case 1: {
										// Input
										// link_info.target_slot from 1 forward
										if (connected) {
											const link = app.graph.links[link_info.id];
											const data_type = app.graph.getNodeById(link.origin_id).outputs[link.origin_slot]?.type ?? "*";

											if (data_type === "HIGHWAY_PIPE" || this.inputs[link_info.target_slot].name[0] === "_")
												break scope;

											if (this.inputs[link_info.target_slot].type === "*") {
												this.inputs[link_info.target_slot].type = data_type;
												this.inputs[link_info.target_slot].name += `:${data_type}`;
											}

											link.color = LGraphCanvas.link_type_colors[data_type];
										} else {
											if (this.inputs[link_info.target_slot].type === "HIGHWAY_PIPE" || this.inputs[link_info.target_slot].name[0] === "_")
												break scope;

											this.inputs[link_info.target_slot].type = "*";
											this.inputs[link_info.target_slot].name = this.inputs[link_info.target_slot].orig_name; // this.inputs[link_info.target_slot].name.split(":")[0];
										}
										this.size = this.computeSize();
									} break;
									case 2: {
										// Output
										// link_info.origin_slot from 1 forward
										if (connected) {
											const link = app.graph.links[link_info.id];
											const data_type = app.graph.getNodeById(link.target_id).inputs[link.target_slot]?.type ?? "*";

											if (data_type === "HIGHWAY_PIPE")
												break scope;

											if (this.outputs[link_info.origin_slot].type === "*") {
												this.outputs[link_info.origin_slot].type = data_type;
												this.outputs[link_info.origin_slot].name = `${data_type}:${this.outputs[link_info.origin_slot].name}`;
											}
										} else {
											if (this.outputs[link_info.origin_slot].type === "HIGHWAY_PIPE")
												break scope;
											
											if (this.outputs[link_info.origin_slot].links.length === 0) {
												this.outputs[link_info.origin_slot].type = "*";
												this.outputs[link_info.origin_slot].name = this.outputs[link_info.origin_slot].orig_name; //this.outputs[link_info.origin_slot].name.split(":")[1];
											}
										}
										this.size = this.computeSize();
									} break;
									default: {
										throw new Error("Unsuported type: " + type);
									}
								}
							}
						}
						rename_flag = false;
					};
				}
				break;
		}
	},
});