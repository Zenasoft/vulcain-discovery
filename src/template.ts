//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.
//
//    Copyright (c) Zenasoft
//
import {ContainerInfo} from './discover'
import {Options} from './options'
import {EventEmitter} from 'events'
import * as fs from 'fs'
import * as childProcess from 'child_process'
import * as http from 'http'
import * as crypto from 'crypto'
import {ConfigDefinition, ClusterDefinition} from './reporter'

export interface VersionInfo
{
    version:string;
    balance:string;
    check:string;
    instances: Array<ContainerInfo>;
}

export interface ServiceInfo
{
    name:string;
    port:number;
    scheme:string;
    versions:Array<VersionInfo>;
}

// Create template for haproxy and notify proxy container to restart if 
//  new config is not equal than the previous one.
// This code is not in the proxy container for updating. The current container can be
//  stopped and updating while the proxy container is running.
export class Template
{
    private proxyGetOptions = {
                host : 'local-proxy',            
                port : 30000,
                path : '/restart', 
                method : 'GET' 
            };
    
    constructor( private options:Options)
    {        
        if( options.proxy) {
            var parts = (<string>options.proxy).split(":");
            if( parts.length == 2)
                this.proxyGetOptions.port = parseInt(parts[1]);
            this.proxyGetOptions.host = parts[0];
        }   
    }

// see https://github.com/tutumcloud/haproxy
//     https://serversforhackers.com/load-balancing-with-haproxy
    transformAsync(cluster:ClusterDefinition, services:Array<ServiceInfo> )
    {        
        let self = this;
        return new Promise((resolve, reject) => {
            try
            {                        
                    let ctx = {frontends:[], backends:[], publicFrontends:null};
                    
                    for(let service of services) 
                    {        
                        // dev expose all services with no binding address
                        if( self.options.proxyMode !== 'public' || self.options.proxyMode === 'dev')
                            self.emitPrivateConfigurations(service, self.options.proxyMode === 'public' && cluster.proxyAddress, ctx);                         
                        if( self.options.proxyMode !== 'private' && self.options.proxyMode !== 'dev')
                            self.emitPublicConfigurations(service, cluster, ctx);
                        self.emitBackends(service, ctx);
                    }
                
                    var newConfig = ctx.frontends.join('\n');
                    if(ctx.publicFrontends)
                        newConfig += ctx.publicFrontends.join('\n');
                    newConfig += ctx.backends.join('\n');    
                    let configFileName = "/var/haproxy/" + this.options.cluster + ".cfg";

                    //resolve(true);return;
                    if( !newConfig) {
                        fs.exists(configFileName, (exists) => {
                            if(exists) {
                                fs.unlink(configFileName, (err) =>
                                {
                                    if(self.options.debug)
                                        console.log("File removed : " + configFileName);
                                    self.onCompleted(resolve, reject, err);
                                });
                            }
                            else
                            {
                                self.onCompleted(resolve, reject, null);
                            }
                        });
                    }
                    else {
                        fs.writeFile(configFileName, newConfig, (err) =>
                        {
                            if(self.options.debug)
                                console.log(configFileName + " -> " + newConfig);
                    
                            self.onCompleted(resolve, reject, err);
                        });
                    }
            }
            catch(e) {
                reject(e);
            }
        });
    }
    
    private onCompleted(resolve, reject, err) {
        if (err)
        {
            reject(err);
        }
        else {
            try {
                if(this.options.debug)
                    console.log("Notify proxy");
                                    
                // Notify proxy 
                http.get(this.proxyGetOptions, function(resp) {
                    resolve(true);
                    //if(resp.statusCode == 200) {self.firstTime=false; self.lastHashCode = hash;}
                })
                .on("error", err => {reject(err)});
            }
            catch(ex) {
                reject(ex);
            }
        }
    }
    
    private emitPrivateConfigurations(service, proxyAddress, ctx) 
    {
        let serviceName = this.options.cluster + "_" + service.name.replace('.', '_') + "_" + service.port;

        ctx.frontends = ctx.frontends.concat([
            "",
            "frontend " + serviceName,
            `  bind ${proxyAddress||"*"}:${service.port}`    
            //`  bind *:${service.port}`
        ]);

        if (service.scheme) {
            ctx.frontends.push("  mode " + service.scheme);
        }

        let last = service.versions[service.versions.length-1];
        for(let version of service.versions)
        {    
            let backend = "backend_" + serviceName + "_" + version.version;
            if (version === last) {
                // last 
                ctx.frontends.push("  default_backend " + backend);
            }
            else {
                var acl = backend + "_acl";
                ctx.frontends.push("  acl " + acl + " path_beg /" + version.version);
                ctx.frontends.push("  use_backend " + backend + " if " + acl);
            }
        }
    }
    
    private emitBackends(service, ctx) 
    {
        let serviceName = this.options.cluster + "_" + service.name.replace('.', '_') + "_" + service.port;

        for(let version of service.versions)
        {    
            let backend = "backend_" + serviceName + "_" + version.version;
            ctx.backends.push("");
            ctx.backends.push("backend " + backend);
            ctx.backends.push("  balance " + (version.balance || "roundrobin"));
            if (service.scheme) {
                ctx.backends.push("  mode " + service.scheme);
            }
                                                            
            version.instances.forEach(instance => 
            {
                instance.ports.forEach(pdef=>
                    ctx.backends.push("  server server_" + instance.id + "_" + pdef.boundedPort + " " + pdef.ip + ":" + pdef.port + " " + (instance.check || ""))
                );
            });
        }
    }
    
    private getPublicPath(version: VersionInfo) {
        let publicPath = version.instances && version.instances.length > 0 && version.instances[0].publicPath;
        if( publicPath) {
            // trim
            if(publicPath[0] === '/')
                publicPath = publicPath.substr(1);
        }
        return publicPath;
    }
    
    private emitPublicConfigurations(service:ServiceInfo, cluster: ClusterDefinition, ctx) 
    {
        if( !service.versions.some(v => this.getPublicPath(v) !== null)) return;
        
        let serviceName = this.options.cluster + "_" + service.name.replace('.', '_') + "_" + service.port;

        if( !ctx.publicFrontends && (cluster.httpAddress || cluster.httpsAddress)) 
        {
            ctx.publicFrontends = [
                "",
                "frontend " + this.options.cluster + "_public_services"
            ];
            
            let http = cluster.httpAddress && cluster.httpAddress.split(':');
            let https = cluster.httpsAddress && cluster.httpsAddress.split(':');
            
            if(cluster.httpAddress) {
                if(http.length === 1)
                    http.push("80");
                ctx.publicFrontends.push(`  bind :${http[1]}`);               
            }
            
            if(cluster.httpsAddress) {
                if(https.length === 1)
                    https.push("443");
                ctx.publicFrontends.push(`  bind :${https[1]}`);
            }

            if (service.scheme) {
                ctx.publicFrontends.push("  mode " + service.scheme);
            }
                   
            let domainAcl = cluster.name + "_host "; // keep ending space 
            if(http) {
                ctx.publicFrontends.push(`  acl ${domainAcl} hdr_beg(host) -i ${http[0]}`);
            }
            if(https) {
                ctx.publicFrontends.push(`  acl ${domainAcl} hdr_beg(host) -i ${https[0]}`);
            }
            
            for(let version of service.versions)
            {    
                let backend = "backend_" + serviceName + "_" + version.version;
                let publicPath = this.getPublicPath(version);
                if (publicPath) 
                {
                    let acl = backend + "_public_acl";
                    ctx.publicFrontends.push("  acl " + acl + " path_reg ^/" + publicPath + "[?\\#]|^/" + publicPath + "$");
                    ctx.publicFrontends.push("  use_backend " + backend + " if " + domainAcl + acl);
                }
            }
        }
    }
}