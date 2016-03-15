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
import {ConfigDefinition} from './reporter'

export interface VersionInfo
{
    default:boolean;
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
    transformAsync(proxyAddress:string, services:Array<ServiceInfo> )
    {        
        let self = this;
        return new Promise((resolve, reject) => {
            try
            {
                fs.readFile(this.options.templateFileName, 'utf8', function (err, data)
                {
                    if (err)
                    {
                        reject(err);
                        return;
                    }
                        
                    let rules = [];
                    for(let service of services) 
                    {        
                        var serviceName = service.name.replace('.', '_') + "_" + service.port;
                        rules = rules.concat([
                            "",
                            "frontend " + serviceName,
                            `  bind ${proxyAddress||"*"} : ${service.port}`
                        ]);

                        if (service.scheme) {
                            rules.push("  mode " + service.scheme);
                        }
                                
                        for(let version of service.versions)
                        {    
                            let backend = "backend_" + serviceName + "_" + version.version;
                            if (version.default) {
                                // last 
                                rules.push("  default_backend " + backend);
                            }
                            else {
                                var acl = backend + "_acl";
                                rules.push("  acl " + acl + " path_beg /" + version.version);
                                rules.push("  use_backend " + backend + " if " + acl);
                            }

                            rules.push("");
                            rules.push("backend " + backend);
                            rules.push("  balance " + (version.balance || "roundrobin"));
                                                                
                            version.instances.forEach(instance => 
                            {
                                instance.ports.forEach(pdef=>
                                    rules.push("  server server_" + instance.id + "_" + pdef.boundedPort + " " + pdef.ip + ":" + pdef.boundedPort + " " + (instance.check || ""))
                                );
                            });
                        }
                    }
                
                    var newConfig = data + rules.join('\n');    
                                
                    fs.writeFile(self.options.configFileName, newConfig, function (err)
                    {
                        if (err)
                        {
                            reject(err);
                            return;
                        }
                        else {
                            try {
                                // Notify proxy 
                                http.get(self.proxyGetOptions, function(resp) {
                                    resolve(true);
                                    //if(resp.statusCode == 200) {self.firstTime=false; self.lastHashCode = hash;}
                                })
                                .on("error", err => {reject(err)});
                            }
                            catch(ex) {
                                reject(ex);
                            }
                        }
                    });
                });
            }
            catch(e) {
                reject(e);
            }
        });
    }
}