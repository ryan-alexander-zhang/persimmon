package com.ryan.persimmon.infra.repository.biz.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.ryan.persimmon.infra.repository.biz.po.DemoBizPO;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface DemoBizMapper extends BaseMapper<DemoBizPO> {}
