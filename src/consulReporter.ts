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
export class ConsulReporter implements IReporter
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
                
        this.consul.kv.set(
            this.hostKey,
            JSON.stringify(hostDefinition),
            { acquire: this.sessionId },
            (err) => { 
                console.log(">> Host registered with %j session : %s, %s", hostDefinition, this.sessionId, err||"");
                if(err)
                    self.panic(err);
            }
        );  
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
    
    async registerServiceAsync(service:ContainerInfo) 
    {
        return new Promise((resolve, reject) => {
            this.consul.kv.set(
                `${this.runtimePrefix}/${service.name}/${service.version}/${service.id}`, 
                JSON.stringify(service),
                {acquire: this.sessionId},
                (err,data) => {
                if(err) 
                    reject(err);
                else {
                    if(this.options.debug)
                        console.log(">> Service registered into kv store " + service.id );
                    resolve(data);
                }
            });
        });
    }
    
    notifyRuntimeChangedAsync() 
    {
        return new Promise<any>((resolve, reject) => 
        {
            this.consul.kv.set(`vulcain/${this.options.cluster}/runtime/services/refresh`, 
                Date.now().toString(), 
                {}, (err,data) => {
                if(err) 
                    reject(err);
                 else {
                    resolve(data);
                 }
            });
        });   
    }
    
    private getAsync(key:string) 
    {
        return new Promise<any>((resolve, reject) => 
        {
            this.consul.kv.get(key, (err,data) => {
                if(err) 
                    reject(err);
                 else {
                    resolve(data);
                 }
            });
        });   
    }
    
    getRuntimeServicesAsync() {
        return new Promise<any>((resolve, reject) => 
        {
            this.consul.kv.get({key:`vulcain/${this.options.cluster}/runtime/services`, recurse:true}, (err,data) => {
                if(err) 
                    reject(err);
                 else {
                    resolve(data);
                 }
            });
        });  
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
        return new Promise((resolve, reject) => {
            let key = this.runtimePrefix;
            this.consul.kv.del({key:key, recurse:true},
            (err,data) => {
                resolve(data);
            });
        });        
    }
    
    removeServiceAsync(service:ContainerInfo) {
        return new Promise((resolve, reject) => {
            let key = `${this.runtimePrefix}/${service.name}/${service.version}/${service.id}`;
            this.consul.kv.del({key:key, recurse:true},
            (err,data) => {
                if(err) 
                    reject(err);
                else {
                    if(this.options.debug)
                        console.log(">> Service removed from kv store " + service.id );
                    resolve(data);
                }
            });
        });        
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