'use strict';

const angular = require('angular');
import _ from 'lodash';

import { ApplicationModelBuilder } from 'core/application/applicationModel.builder';
import { EXECUTION_SERVICE } from 'core/pipeline/service/execution.service';
import { RecentHistoryService } from 'core/history/recentHistory.service';
import { SchedulerFactory } from 'core/scheduler/SchedulerFactory';
import { PROJECT_PIPELINE_COMPONENT } from './pipeline/projectPipeline.component';
import { ProjectReader } from '../service/ProjectReader';

import './dashboard.less';

module.exports = angular
  .module('spinnaker.core.projects.dashboard.controller', [
    require('./cluster/projectCluster.directive').name,
    PROJECT_PIPELINE_COMPONENT,
    EXECUTION_SERVICE,
    require('./regionFilter/regionFilter.component').name,
    require('./regionFilter/regionFilter.service').name,
  ])
  .controller('ProjectDashboardCtrl', [
    '$scope',
    '$rootScope',
    'projectConfiguration',
    'executionService',
    'regionFilterService',
    '$q',
    function($scope, $rootScope, projectConfiguration, executionService, regionFilterService, $q) {
      this.project = projectConfiguration;
      this.application = ApplicationModelBuilder.createStandaloneApplication('project');

      // These templates are almost identical, but it doesn't look like you can pass in a directive easily as a tooltip so
      // here they are
      this.clusterRefreshTooltipTemplate = require('./clusterRefresh.tooltip.html');
      this.executionRefreshTooltipTemplate = require('./executionRefresh.tooltip.html');

      if (projectConfiguration.notFound) {
        RecentHistoryService.removeLastItem('projects');
        return;
      } else {
        RecentHistoryService.addExtraDataToLatest('projects', {
          config: {
            applications: projectConfiguration.config.applications,
          },
        });
      }

      this.state = {
        executions: {
          initializing: true,
          refreshing: false,
          loaded: false,
          error: false,
        },
        clusters: {
          initializing: true,
          refreshing: false,
          loaded: false,
          error: false,
        },
      };

      let getClusters = () => {
        let state = this.state.clusters;
        state.error = false;
        state.refreshing = true;

        let clusterCount = _.get(projectConfiguration.config.clusters, 'length');
        let clustersPromise;

        if (clusterCount > 0) {
          clustersPromise = ProjectReader.getProjectClusters(projectConfiguration.name);
        } else if (clusterCount === 0) {
          clustersPromise = $q.when([]);
        } else {
          // shouldn't hide error if clusterCount is somehow undefined.
          clustersPromise = $q.reject(null);
        }

        return clustersPromise
          .then(clusters => {
            this.clusters = clusters;
            this.allRegions = getAllRegions(clusters);
            state.initializing = false;
            state.loaded = true;
            state.refreshing = false;
            state.lastRefresh = new Date().getTime();
          })
          .catch(() => {
            state.initializing = false;
            state.refreshing = false;
            state.error = true;
          });
      };

      let getExecutions = () => {
        let state = this.state.executions;
        state.error = false;
        state.refreshing = true;
        return executionService
          .getProjectExecutions(projectConfiguration.name)
          .then(executions => {
            this.executions = executions;
            state.initializing = false;
            state.loaded = true;
            state.refreshing = false;
            state.lastRefresh = new Date().getTime();
            regionFilterService.activate();
            regionFilterService.runCallbacks();
          })
          .catch(() => {
            state.initializing = false;
            state.refreshing = false;
            state.error = true;
          });
      };

      let getAllRegions = clusters => {
        return _.chain(clusters)
          .map('applications')
          .flatten()
          .map('clusters')
          .flatten()
          .map('region')
          .uniq()
          .value();
      };

      let clusterScheduler = SchedulerFactory.createScheduler(3 * 60 * 1000),
        executionScheduler = SchedulerFactory.createScheduler(3 * 60 * 1000);

      let clusterLoader = clusterScheduler.subscribe(getClusters);

      let executionLoader = executionScheduler.subscribe(getExecutions);

      $scope.$on('$destroy', () => {
        clusterScheduler.unsubscribe();
        clusterLoader.unsubscribe();

        executionScheduler.unsubscribe();
        executionLoader.unsubscribe();
      });

      this.refreshClusters = clusterScheduler.scheduleImmediate;
      this.refreshExecutions = executionScheduler.scheduleImmediate;

      this.refreshClusters();
      this.refreshExecutions();

      $scope.$on(
        '$destroy',
        $rootScope.$on('$locationChangeSuccess', () => {
          regionFilterService.activate();
          regionFilterService.runCallbacks();
        }),
      );
    },
  ]);
