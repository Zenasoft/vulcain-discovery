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
var Consul = require('consul');
import {ContainerInfo} from './discover'
import {Options} from './options'
import * as os from 'os'
import * as util from 'util'
var Rx =require('rx')
import * as events from 'events';
import {ServiceDefinition, ServiceVersionDefinition, IReporter} from './reporter'

// vulcain/<cluster>/runtime/services/<host>/<name>/<version>/<id>
// vulcain/<cluster>/runtime/hosts/<host>
export class AbstractReporter implements IReporter
{
    private lastRefreshValue:string;
    private consul;
    private runtimePrefix:string;
    private sessionId:string;
    private lastIndex:string;
    private Options:Options;
    private hostKey:string;
    
    constructor(private options:Options, private panic: (err)=>void) 
    {
        this.options.ttl = options.ttl || 30;
        this.consul = Consul({ host:options.kv || "local-store"});  
        this.runtimePrefix = `vulcain/${options.cluster}/runtime/services/${os.hostname()}`;  
        this.hostKey = `vulcain/${this.options.cluster}/runtime/hosts/${os.hostname()}`;
        console.log("Starting consul reporter on " + (options.kv || "local-store"));
    }

    async startAsync() 
    {
        let self = this;
        await this.createSessionAsync();
        
        // Start the session renew process
        setTimeout( this.renewAsync.bind(this), this.options.ttl*1000/2);
        
        // Register host
        let hostDefinition = 
        {
            name:os.hostname(), 
            ip:this.options.hostIp, 
            platform: os.type(), 
            cluster:this.options.cluster,
            memory: os.totalmem(),
            infos: [
                {"discovery" : this.options.version}
            ]
        }; 
        
        try {
            this.setAsync(this.hostKey, JSON.stringify(hostDefinition));
        }
        catch(err) {
            console.log(">> Host registered with %j session : %s, %s", hostDefinition, this.sessionId, err||"");
            if(err)
                self.panic(err);
        }
    }
    
    private setAsync(key:string, value) 
    {
        return new Promise((resolve, reject) => 
        {
            this.consul.kv.set(
                key,
                value,
                { acquire: this.sessionId }, 
                (err) => {
                    if(err)
                    reject(err);
                    else
                        resolve();
                }
            );
        });  
    }
    
    private removeRecursiveAsync(key:string, recurse?:boolean) 
    {
        return new Promise<any>((resolve, reject) => 
        {
            this.consul.kv.del({key:key, recurse:!!recurse}, (err,data) => {
                if(err) 
                    reject(err);
                 else {
                    resolve(data);
                 }
            });
        });   
    }
    
    private getAsync(key:string, recurse?:boolean) 
    {
        return new Promise<any>((resolve, reject) => 
        {
            this.consul.kv.get({key:key, recurse:!!recurse}, (err,data) => {
                if(err) 
                    reject(err);
                 else {
                    resolve(data);
                 }
            });
        });   
    }
    
    createSessionAsync() 
    {
        let self = this;
        return new Promise((resolve, reject) => 
        {
            console.log("Creating a session with ttl=" + this.options.ttl);
                
            this.consul.session.create({ttl:`${this.options.ttl}s`, behavior:"delete", lockDelay:"1s"}, (err,data)=>
            {
                if(err) {
                    self.panic(err);
                    reject(err);
                }
                else {
                    this.sessionId = data.ID;
                    console.log("Consul session initialized with id=" + this.sessionId);                    
                    resolve(data.ID);
                }
            });    
        });
    }
    
    renewSessionAsync() 
    {
        return new Promise((resolve, reject) => 
        {
           if(this.options.debug)
                util.log(">> Renew session " + this.sessionId );
                
            this.consul.session.renew(this.sessionId, (err,data) => {
                if(err) {
                    if(this.options.debug)
                        util.log("Renew failed " + err);
                    reject(err);
                }
                else {
                    if(this.options.debug)
                        util.log("Renew ok ");
                    resolve(data);
                }
            });
        });        
    }
        
    private async renewAsync() 
    {
        let self = this;
        try 
        {
            await self.renewSessionAsync();
            let host = await this.getAsync(this.hostKey);
            if(!host) {
                self.panic("Host Watchdog failed.");
                return;
            }
            
            setTimeout( self.renewAsync.bind(self), self.options.ttl * 1000 / 2);
        }
        catch(e) {
            self.panic(e);
        }
    }
    
    async registerServiceAsync(service:ContainerInfo) 
    {
        await this.setAsync(`${this.runtimePrefix}/${service.name}/${service.version}/${service.id}`, JSON.stringify(service));
        if(this.options.debug)
            console.log(">> Service registered into kv store " + service.id ); 
    }
    
    notifyRuntimeChangedAsync() 
    {
        return this.setAsync(`vulcain/${this.options.cluster}/runtime/services/refresh`, Date.now().toString()); 
    }
    
    getRuntimeServicesAsync() {
        return this.getAsync(`vulcain/${this.options.cluster}/runtime/services`, true);
    }
    
    async getServiceDefinitionAsync(name:string) : Promise<ServiceDefinition> {
        let data = await this.getAsync(`vulcain/${this.options.cluster}/definitions/services/${name}`);
        return data && JSON.parse(data.Value);
    }
    
    async getServiceVersionDefinitionAsync(name:string, version:string) : Promise<ServiceVersionDefinition> {
        let data = await this.getAsync(`vulcain/${this.options.cluster}/definitions/services/${name}/${version}`);
        return data && JSON.parse(data.Value);
    }
    
    removeServicesAsync() {
        return this.removeRecursiveAsync(this.runtimePrefix);    
    }
    
    removeServiceAsync(service:ContainerInfo) 
    {
        return this.removeRecursiveAsync(`${this.runtimePrefix}/${service.name}/${service.version}/${service.id}`);     
    }
    
    // Listening on changes in service definitions via webadmin
    // In this case, we will reset local services (for example a service has been disabled/enabled and must be updated)
    watchDefinitionsChanges(queue) 
    {
        let self = this;
        let watch = this.consul.watch({ method: this.consul.kv.get, options: { key: `vulcain/${this.options.cluster}/definitions/services/refresh` }});

        watch.on('change', function(data, res) {
            if(data && self.lastRefreshValue !== data.Value) 
            {
                console.log("Global service definition changes detected....");
                queue.onNext(data.Value);
                self.lastRefreshValue = data.Value;
            }
        });

        watch.on('error', function(err) {
            watch.end();
            self.panic(err);
        });
    }
    
    // Listening on runtime changes updated by discovery agent (local or remote).
    // We don't know which agent initiate the changes so we re read all services 
    watchRuntimeChanges(queue) 
    {
        let self = this;
        let watch = this.consul.watch({ method: this.consul.kv.get, options: { recurse:true, key: `vulcain/${this.options.cluster}/runtime/services/refresh` }});

        watch.on('change', function(data, res) {
            if(data) 
            {
                console.log("Service runtime changes detected....");
                queue.onNext(true);
            }
        });

        watch.on('error', function(err) {
            watch.end();
            self.panic(err);
        });
    }
}