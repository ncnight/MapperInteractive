define(function (require) {

  const app = require('app');
  const GraphMode = require('../mode');
  const d3 = require('d3');
  const _ = require('underscore');

  return class SelectPathMode extends GraphMode {

    constructor() {
      super();
      this.name = 'select-path';
      this.label = 'click to select paths';
      this.CLASS_NAME_ANCHOR = '--anchor';

      this.model = app.model({
        'selection': []
      });
    }

    willMount() {
      super.willMount()
    }

    didMount() {
      this.draggable = this.graph.behaviors.get('draggable');
    }

    willActivate() {
      if (this.draggable) {
        this.draggable.pause();
      }
      this.anchors = [];
      this.clear();
      this.preparing();
    }

    didActivate() {
      super.didActivate();
      this.markInitialCandidates();
      this.listenTo('graph:didRender', (e) => this.graphDidRender(e));
      this.listenTo('node:click', (e) => this.nodeClick(e));
      this.listenTo('node:mouseover', (e) => this.nodeMouseover(e));
      this.listenTo('node:mouseout', (e) => this.nodeMouseout(e));
    }

    willDeactivate() {
      if (this.draggable) {
        this.draggable.resume();
      }
      this.clear();
      this.stopListening();
    }

    didDeactivate() {
      super.didDeactivate();
      this.stopListening();
    }

    graphDidRender(e) {
      this.clear();
      this.anchors = [];
      this.preparing();
      this.markInitialCandidates();
    }

    nodeClick(e) {
      let target = d3.select(e.target);
      if (target.classed(this.graph.CLASS_NAME_UNAVAILABLE)) {
        return false;
      }

      target.classed(this.CLASS_NAME_ANCHOR, true)
        .classed(this.graph.CLASS_NAME_SELECTED, true);

      let clickedNodeId = target.datum()["id"];

      // for the first anchor, only update the shortest paths
      if (this.anchors.length === 0) {
        this.shortestPaths = this.dijkstra(clickedNodeId);
        this.setCandidates(_.flatten(_.pairs(this.shortestPaths)));
        this.anchors.push(clickedNodeId);
        this.findNodeById(clickedNodeId).classed(this.CLASS_NAME_ANCHOR, true);

        let selection = [clickedNodeId];
        this.model.set('selection', selection);

      } else {
        // make a copy in order to trigger event on model
        // if not, the selection will shadow updated without using `set` on model
        let selection = this.model.get('selection').slice();

        // if we have last anchor,
        // select the nodes on the path using previous shortest paths
        let previousAnchorId = this.anchors[this.anchors.length - 1];

        // path selection is from end to begin
        // so we need to reverse before merge it to graph selection
        let pathSelection = [];
        this.selectAlongThePath(previousAnchorId, clickedNodeId, pathSelection);
        selection = selection.concat(pathSelection.reverse());

        this.anchors.push(clickedNodeId);
        this.findNodeById(clickedNodeId).classed(this.CLASS_NAME_ANCHOR, true);

        // update shortest paths base on latest anchor
        this.shortestPaths = this.dijkstra(clickedNodeId);

        this.model.set('selection', selection);
      }
    }

    nodeMouseover(e) {
      let target = d3.select(e.target);

      if (target.classed(this.graph.CLASS_NAME_UNAVAILABLE)) {
        return;
      }

      let nodeId = target.datum()["id"];
      this.highlightPotentialAnchor(nodeId);

      if (this.anchors.length > 0) {
        this.highlightPotentialPath(nodeId);
      }
    }

    nodeMouseout(e) {
      this.clearPotentialSelection();
    }

    dijkstra(startId) {

      let paths = {};
      let nodeIdList = _.keys(this.nodes);
      let distances = _.object(nodeIdList, nodeIdList.map(() => Number.POSITIVE_INFINITY));

      distances[startId] = 0;

      let unvisited = nodeIdList.slice();

      while (unvisited.length > 0) {

        let currentId = undefined;
        let nearestDistance = Number.POSITIVE_INFINITY;

        unvisited.forEach((id) => {
          if (distances[id] < nearestDistance) {
            currentId = id;
            nearestDistance = distances[id];
          }
        });
        unvisited.splice(unvisited.indexOf(currentId), 1);

        // no unvisited node in current cluster
        if (currentId === undefined) {
          break;
        }

        this.nodes[currentId]["neighbors"].map((neighborId) => {
          if (unvisited.indexOf(neighborId) > -1) {
            if (distances[neighborId] > distances[currentId] + 1) {
              distances[neighborId] = distances[currentId] + 1;
              paths[neighborId] = currentId;
            }
          }
        });
      }

      return paths;
    }

    markInitialCandidates() {
      this.graph.nodes.filter((d) => {
        return this.nodes[d["id"]]["neighbors"].length === 0;
      }).classed(this.graph.CLASS_NAME_UNAVAILABLE, true);
    }

    setCandidates(nodeIdList) {
      this.graph.nodes.filter((d) => {
        return nodeIdList.indexOf(d["id"]) === -1;
      }).classed(this.graph.CLASS_NAME_UNAVAILABLE, true);

      this.graph.links.filter((d) => {
        return nodeIdList.indexOf(d['source']['id']) === -1
          && nodeIdList.indexOf(d['target']['id']) === -1;
      }).classed(this.graph.CLASS_NAME_UNAVAILABLE, true);
    }

    preparing() {
      this.nodes = _.object(this.graph.nodes.data().map((n) => {
        return [n["id"], {"id": n["id"], "neighbors": []}];
      }));

      this.graph.links.data().forEach((link) => {
        this.nodes[link["source"]["id"]]["neighbors"].push(link["target"]["id"]);
        this.nodes[link["target"]["id"]]["neighbors"].push(link["source"]["id"]);
      });

      _.mapObject(this.nodes, (val, key) => {
        this.nodes[key]["neighbors"] = _.uniq(this.nodes[key]["neighbors"]);
      });
    }

    selectAlongThePath(fromId, toId, selection) {
      let currentId = toId;
      while (this.shortestPaths[currentId]) {
        this.selectNode(currentId);
        selection.push(currentId);

        let nextId = this.shortestPaths[currentId];

        let endpoints = [currentId, nextId].sort();
        this.graph.links.filter((d) => {
          let edgePoints = [d['source']['id'], d['target']['id']].sort();
          return endpoints[0] === edgePoints[0] && endpoints[1] === edgePoints[1];
        }).classed(this.graph.CLASS_NAME_SELECTED, true);

        currentId = nextId;
      }
    }

    selectNode(id) {
      this.findNodeById(id).classed(this.graph.CLASS_NAME_SELECTED, true);
    }

    highlightPotentialAnchor(id) {
      this.findNodeById(id).classed(this.graph.CLASS_NAME_CANDIDATE, true);
    }

    highlightPotentialPath(potentialAnchorId) {
      let lastAnchorId = this.anchors[this.anchors.length - 1];
      let currentId = potentialAnchorId;

      while (this.shortestPaths[currentId]) {
        currentId = this.shortestPaths[currentId];
        if (currentId === lastAnchorId) {
          break;
        }
        this.findNodeById(currentId).classed(this.graph.CLASS_NAME_CANDIDATE, true)
      }
    }

    clearPotentialSelection() {
      this.graph.nodes.classed(this.graph.CLASS_NAME_CANDIDATE, false);
    }

    findNodeById(id) {
      return this.graph.nodes.filter((d) => d["id"] === id);
    }

    clear() {
      this.clearPotentialSelection();
      this.graph.nodes.classed(this.graph.CLASS_NAME_UNAVAILABLE, false);
      this.graph.nodes.classed(this.graph.CLASS_NAME_SELECTED, false);
      this.graph.nodes.classed(this.CLASS_NAME_ANCHOR, false);
      this.graph.links.classed(this.graph.CLASS_NAME_SELECTED, false);
      this.graph.trigger('change:selection', []);
    }
  }


})
;